import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException
from lobby import api
from lobby.rooms import LobbyRoom, RoomError
from test_lobby_api import MemoryRedis


class MobileLobbyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        api.locks.clear(); api.connections.clear(); api.transitions.clear()
        api.configure(MemoryRedis(), MagicMock(), MagicMock(), {}, {})

    async def asyncTearDown(self):
        for tasks in (api.countdowns, api.owner_timers):
            for rid in list(tasks): api.cancel_task(tasks, rid)
        await asyncio.sleep(0)

    async def create(self, pid='host', password=''):
        return await api.create_room(api.Profile(player_id=pid, name='小明', avatar='🐭', password=password))

    async def test_directory_and_all_public_responses_exclude_credentials(self):
        data = await self.create(password='abcd')
        saved = await api.load(data['id'])
        self.assertNotEqual(saved.data['password_hash'], 'abcd')
        self.assertTrue(saved.check_password('abcd'))
        self.assertFalse(saved.check_password('wrong'))
        for result in (data, await api.preview(data['id']), (await api.list_rooms())[0]):
            self.assertTrue(result['has_password'])
            self.assertNotIn('password_hash', result)
            self.assertNotIn('abcd', json.dumps(result))
        summary = (await api.list_rooms())[0]
        self.assertEqual(summary['owner_name'], '小明')
        self.assertEqual(summary['capacity'], 12)
        self.assertNotIn('members', summary)
        self.assertNotIn('owner_id', summary)
        self.assertNotIn('game_state', summary)

    async def test_password_join_update_reconnect_and_ban(self):
        data = await self.create(password='abcd'); rid = data['id']
        guest = dict(player_id='guest', name='朋友', avatar='🐸')
        with self.assertRaises(HTTPException) as error:
            await api.join_room(rid, api.Profile(**guest, password='wrong'))
        self.assertEqual(error.exception.status_code, 403)
        await api.join_room(rid, api.Profile(**guest, password='abcd'))
        await api.change_password(rid, api.PasswordRequest(player_id='host', password='new-pass'))
        # An existing member reconnects without entering a changed password.
        await api.join_room(rid, api.Profile(**guest))
        await api.leave_room(rid, {'player_id':'guest'})
        with self.assertRaises(HTTPException): await api.join_room(rid, api.Profile(**guest, password='abcd'))
        await api.join_room(rid, api.Profile(**guest, password='new-pass'))
        await api.manage(rid, api.MemberRequest(player_id='host', target_id='guest'), 'kick')
        with self.assertRaises(HTTPException): await api.join_room(rid, api.Profile(**guest, password='new-pass'))
        await api.change_password(rid, api.PasswordRequest(player_id='host'))
        self.assertFalse((await api.preview(rid))['has_password'])

    async def test_password_validation_and_permissions(self):
        for password in ('abc', 'has space', ' '):
            with self.assertRaises(HTTPException): await self.create(password=password)
        data = await self.create()
        with self.assertRaises(HTTPException): await api.change_password(data['id'], api.PasswordRequest(player_id='unknown', password='abcd'))

    async def test_countdown_join_preserves_token_readiness_and_seats(self):
        r=LobbyRoom('123456','host','小明','🐭');r.join('p1','朋友','🐸');r.configure_game('host','holdem',{})
        for pid in r.data['seats']:r.ready(pid,True,r.data['revision'])
        r.arm();before=r.snapshot();await api.save(r)
        joined=await api.join_room(r.data['id'],api.Profile(player_id='late',name='晚到',avatar='🐱'))
        self.assertEqual(joined['countdown'],before['countdown'])
        self.assertEqual(joined['revision'],before['revision'])
        self.assertEqual(joined['seats'],before['seats'])
        self.assertTrue(joined['members']['host']['ready'])

    async def playing(self, game='holdem'):
        r=LobbyRoom('123456','host','小明','🐭');r.configure_game('host',game,{})
        r.data.update(stage='playing',session_id='active')
        api.runtimes[game]=SimpleNamespace(snapshot=AsyncMock(return_value={'phase':'night','status':'playing','players':{'host':{}}}),detach=AsyncMock())
        await api.save(r,add_player='host')
        return r

    async def test_candidate_does_not_change_session_and_can_leave(self):
        r=await self.playing();before=r.snapshot()
        joined=await api.join_room(r.data['id'],api.Profile(player_id='late',name='晚到',avatar='🐸'))
        self.assertEqual(joined['pending_member_ids'],['late'])
        for key in ('seats','revision','session_id'):self.assertEqual(joined[key],before[key])
        self.assertNotIn('late',joined['session_members'])
        with self.assertRaises(HTTPException):await api.seat(r.data['id'],api.SeatRequest(player_id='late',target_id='late',seated=True))
        await api.leave_room(r.data['id'],{'player_id':'late'})
        self.assertEqual((await api.load(r.data['id'])).data['pending_member_ids'],[])
        self.assertIsNone(await api.db().get(api.PLAYER_PREFIX+'late'))

    async def test_candidates_rejected_at_each_game_socket(self):
        import main
        from games.bluff.service import game_socket
        for game in ('cheese','holdem','bluff'):
            r=await self.playing(game)
            await api.join_room(r.data['id'],api.Profile(player_id='late',name='晚到',avatar='🐸'))
            ws=SimpleNamespace(close=AsyncMock(),accept=AsyncMock())
            if game=='cheese':await main.websocket_endpoint(ws,'late')
            elif game=='holdem':await main.holdem_socket(ws,r.data['id'],'late')
            else:await game_socket(ws,r.data['id'],'late')
            ws.accept.assert_not_awaited();ws.close.assert_awaited_once_with(code=4403)

    async def test_return_retains_original_seats_and_releases_candidates(self):
        r=await self.playing()
        await api.join_room(r.data['id'],api.Profile(player_id='late',name='晚到',avatar='🐸'))
        api.runtimes['holdem'].snapshot.return_value={'status':'finished','players':{'host':{}}}
        result=await api.return_room(r.data['id'],api.MemberRequest(player_id='host'))
        self.assertEqual(result['pending_member_ids'],[])
        self.assertEqual(result['seats'],['host'])
        self.assertIn('late',result['members'])

    async def test_profile_change_preserves_readiness_and_updates_owner_summary(self):
        data=await self.create();rid=data['id']
        result=await api.update_profile(rid,api.Profile(player_id='host',name='新名字',avatar='🦊'))
        self.assertEqual(result['members']['host']['avatar'],'🦊')
        self.assertEqual((await api.list_rooms())[0]['owner_name'],'新名字')
        r=await self.playing()
        with self.assertRaises(HTTPException):await api.update_profile(r.data['id'],api.Profile(player_id='host',name='新名字',avatar='🦊'))

    async def test_legacy_defaults_and_full_room(self):
        r=LobbyRoom('123456','host','小明','🐭')
        old=r.snapshot()
        for field in ('password_hash','created_at','pending_member_ids'):old.pop(field)
        restored=LobbyRoom.restore(old)
        self.assertIsNone(restored.data['password_hash']);self.assertEqual(restored.data['created_at'],0)
        for i in range(11):restored.join(f'p{i}',f'朋友{i}','🐸')
        await api.save(restored)
        self.assertFalse((await api.list_rooms())[0]['joinable'])
        with self.assertRaises(RoomError):restored.join('overflow','朋友','🐸')

    async def test_replaced_holdem_socket_is_closed(self):
        from games.holdem.ws_manager import ConnectionManager
        manager = ConnectionManager()
        old = SimpleNamespace(accept=AsyncMock(), close=AsyncMock())
        new = SimpleNamespace(accept=AsyncMock(), close=AsyncMock())
        await manager.connect('room', 'host', old)
        await manager.connect('room', 'host', new)
        old.close.assert_awaited_once_with(code=4001)
        self.assertIs(manager.rooms['room']['host'], new)

    async def test_concurrent_last_seat_join_respects_capacity(self):
        r=LobbyRoom('123456','host','小明','🐭')
        for i in range(10): r.join(f'p{i}',f'朋友{i}','🐸')
        await api.save(r)
        results=await asyncio.gather(*(api.join_room('123456',api.Profile(player_id=f'late{i}',name='迟到',avatar='🐱')) for i in range(2)),return_exceptions=True)
        self.assertEqual(sum(isinstance(v,dict) for v in results),1)
        self.assertEqual(len((await api.load('123456')).data['members']),12)

    async def test_nickname_collision_checks_join_profile_and_reconnect(self):
        data = await api.create_room(api.Profile(player_id='host',name='摸鱼小熊#07',avatar='animal-01'))
        rid=data['id'];self.assertEqual(data['members']['host']['name'],'摸鱼小熊')
        for value in ['摸鱼小熊','摸鱼小熊07','摸鱼小熊#99']:
            with self.assertRaises(HTTPException) as caught:
                await api.join_room(rid,api.Profile(player_id='guest',name=value,avatar='animal-02'))
            self.assertEqual(caught.exception.status_code,409)
            self.assertEqual(caught.exception.detail['code'],'nickname_taken')
        await api.join_room(rid,api.Profile(player_id='guest',name='奶茶海獭',avatar='animal-02'))
        await api.join_room(rid,api.Profile(player_id='guest',name='奶茶海獭',avatar='animal-02'))
        with self.assertRaises(HTTPException):
            await api.update_profile(rid,api.Profile(player_id='guest',name='摸鱼小熊',avatar='animal-03'))
        current=await api.get_room(rid,'guest');self.assertEqual(current['members']['guest']['name'],'奶茶海獭')
        await api.update_profile(rid,api.Profile(player_id='guest',name='奶茶海獭',avatar='animal-03'))
        outcomes=await asyncio.gather(*(api.join_room(rid,api.Profile(player_id=pid,name='快乐水豚',avatar='animal-04')) for pid in ['a','b']),return_exceptions=True)
        self.assertEqual(sum(isinstance(value,dict) for value in outcomes),1)
        self.assertEqual(sum(isinstance(value,HTTPException) for value in outcomes),1)
        self.assertEqual(len((await api.get_room(rid,'host'))['members']),3)

    async def test_latency_ping_is_uncached_and_socket_pongs_echo_probe_id(self):
        response=await api.latency_ping()
        self.assertEqual(json.loads(response.body),{'type':'pong'})
        self.assertEqual(response.headers['cache-control'],'no-store')
        data=await self.create();rid=data['id']
        from starlette.websockets import WebSocketDisconnect
        ws=SimpleNamespace(accept=AsyncMock(),close=AsyncMock(),send_json=AsyncMock(),
            receive_json=AsyncMock(side_effect=[{'type':'ping','id':42},{'type':'ping'},WebSocketDisconnect()]))
        await api.room_socket(ws,rid,'host')
        messages=[call.args[0] for call in ws.send_json.await_args_list]
        self.assertIn({'type':'pong','id':42},messages)
        self.assertIn({'type':'pong','id':None},messages)
