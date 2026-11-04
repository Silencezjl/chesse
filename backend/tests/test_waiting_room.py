import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException
from lobby import api
from lobby.rooms import LobbyRoom, RoomError
from test_lobby_api import MemoryRedis


class WaitingRoomTest(unittest.TestCase):
    def room(self, count=5, game='cheese'):
        room = LobbyRoom('123456', 'p0', '房主', '🐭')
        for i in range(1, count): room.join(f'p{i}', f'玩家{i}', '🐱')
        room.configure_game('p0', game, {})
        return room

    def test_ready_is_explicit_idempotent_and_spectators_do_not_block(self):
        r = self.room(9)
        self.assertEqual(len(r.data['seats']), 8)
        for pid in r.data['seats']:
            r.ready(pid, True, r.data['revision'])
            r.ready(pid, True, r.data['revision'])
        r.arm(100)
        self.assertEqual(r.data['countdown']['deadline'], 103)
        token = r.data['countdown']['token']
        r.arm(101)
        self.assertEqual(r.data['countdown']['token'], token)
        r.join('p9', '观众', '🐱')
        self.assertEqual(r.data['countdown']['token'], token)
        with self.assertRaises(RoomError): r.ready('p9', True, r.data['revision'])

    def test_changes_disconnect_and_seat_mutations_cancel(self):
        for change in ('settings', 'disconnect', 'seat', 'cancel'):
            r = self.room()
            revision = r.data['revision']
            for p in r.data['seats']: r.ready(p, True, revision)
            r.arm()
            if change == 'settings': r.configure_game('p0', 'cheese', {'max_dice': 7})
            elif change == 'disconnect': r.disconnect('p1')
            elif change == 'seat': r.seat('p0', 'p1', False)
            else: r.ready('p1', False, revision)
            self.assertIsNone(r.data['countdown'])
            self.assertFalse(r.can_start())
        with self.assertRaises(RoomError): r.ready('p0', True, revision - 1)

    def test_capacity_minimum_permissions_and_midgame_join(self):
        r=self.room(2, 'holdem')
        for p in r.data['seats']: r.ready(p, True, r.data['revision'])
        self.assertTrue(r.can_start())
        r.data['stage']='playing'
        r.join('new', '朋友', '🐸')
        self.assertIn('new', r.data['pending_member_ids'])
        self.assertNotIn('new', r.data['seats'])
        with self.assertRaises(RoomError): r.seat('p0','p1',False)
        r.data['stage']='waiting'
        with self.assertRaises(RoomError): r.configure_game('p1','bluff',{})
        with self.assertRaises(RoomError): r.seat('p1','p0',False)

    def test_failover_grace_order_and_deferred_during_game(self):
        r=self.room()
        r.disconnect('p0');r.failover(100)
        r.failover(159);self.assertEqual(r.data['owner_id'],'p0')
        r.data['stage']='playing';r.failover(161);self.assertEqual(r.data['owner_id'],'p0')
        r.data['stage']='finished';r.failover(162);self.assertEqual(r.data['owner_id'],'p1')

    def test_old_snapshot_retains_session_and_gains_safe_defaults(self):
        old={'id':'123456','owner_id':'p0','members':{'p0':{'name':'旧玩家','avatar':'🐭','connected':True}},'game_id':'cheese','game_state':{'phase':'night'},'session_id':'original'}
        r=LobbyRoom.restore(old)
        self.assertEqual(r.data['stage'],'playing')
        self.assertEqual(r.data['session_id'],'original')
        self.assertFalse(r.data['members']['p0']['ready'])
        self.assertIsNone(r.data['countdown'])

    def test_spectators_do_not_receive_cheese_roles_or_votes(self):
        from game import Room
        from models import Player
        game = Room('privacy', 'p0')
        for i in range(5): game.add_player(Player(f'p{i}'))
        game.add_spectator(Player('observer'))
        game.start_game()
        state = game.get_room_state('observer')
        self.assertNotIn('thief_id', state)
        self.assertNotIn('vote_results', state)
        self.assertTrue(all('role' not in p and 'dice' not in p for p in state['players'].values()))


class WaitingApiTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for tasks in (api.countdowns,api.owner_timers):
            for rid in list(tasks): api.cancel_task(tasks,rid)
        api.locks.clear();api.connections.clear();api.transitions.clear()
        api.configure(MemoryRedis(),MagicMock(),MagicMock(),{}, {})

    async def asyncTearDown(self):
        for tasks in (api.countdowns,api.owner_timers):
            for rid in list(tasks): api.cancel_task(tasks,rid)
        await asyncio.sleep(0)

    async def prepared(self):
        r=LobbyRoom('123456','p0','房主','🐭');r.join('p1','朋友','🐱');r.configure_game('p0','holdem',{})
        await api.save(r)
        return r

    async def test_only_one_session_from_concurrent_ready_and_timer(self):
        r=await self.prepared()
        runtime=SimpleNamespace(install=AsyncMock(),begin=AsyncMock(),detach=AsyncMock(),snapshot=AsyncMock(return_value={'status':'playing'}))
        api.runtimes['holdem']=runtime
        req=lambda pid:api.ReadyRequest(player_id=pid,ready=True,revision=r.data['revision'])
        await asyncio.gather(api.ready('123456',req('p0')),api.ready('123456',req('p1')))
        r=await api.load('123456');c=r.data['countdown'];api.cancel_task(api.countdowns,'123456')
        await asyncio.gather(api.finish_countdown('123456',c['token'],time.time()),api.finish_countdown('123456',c['token'],time.time()))
        self.assertEqual(runtime.install.await_count,1)
        self.assertEqual(runtime.begin.await_count,1)
        self.assertEqual((await api.load('123456')).data['stage'],'playing')

    async def test_select_only_configures_and_failed_launch_is_retryable(self):
        r=await self.prepared()
        runtime=SimpleNamespace(install=AsyncMock(side_effect=RuntimeError('disk')),detach=AsyncMock())
        api.runtimes['holdem']=runtime
        await api.select_game(r.data['id'],api.SelectGame(player_id='p0',game_id='holdem'))
        runtime.install.assert_not_awaited()
        r=await api.load(r.data['id'])
        for p in r.data['seats']:r.ready(p,True,r.data['revision'])
        r.arm();await api.save(r)
        with self.assertRaises(RuntimeError): await api.launch(r)
        restored=await api.load(r.data['id'])
        self.assertEqual(restored.data['stage'],'waiting')
        self.assertIsNone(restored.data.get('session_id'))
        self.assertTrue(restored.data['start_error'])
        self.assertNotIn(r.data['id'],api.transitions)

    async def test_old_timer_and_restart_cannot_start(self):
        r=await self.prepared()
        for p in r.data['seats']:r.ready(p,True,r.data['revision'])
        r.arm();c=r.data['countdown'];await api.save(r)
        await api.reset_presence()
        await api.finish_countdown(r.data['id'],c['token'],time.time())
        fresh=await api.load(r.data['id'])
        self.assertEqual(fresh.data['stage'],'waiting')
        self.assertTrue(all(not m['ready'] and not m['connected'] for m in fresh.data['members'].values()))

    async def test_kick_blocks_rejoin_and_no_private_state_in_preview(self):
        r=await self.prepared()
        result=await api.preview(r.data['id'])
        self.assertNotIn('members',result)
        self.assertNotIn('game_state',await api.public(r))
        await api.manage(r.data['id'],api.MemberRequest(player_id='p0',target_id='p1'),'kick')
        with self.assertRaises(HTTPException):await api.join_room(r.data['id'],api.Profile(player_id='p1',name='朋友',avatar='🐱'))

    async def test_new_member_in_finished_room_is_not_in_previous_session(self):
        r = await self.prepared()
        r.data.update(stage='finished', session_id='old')
        await api.save(r)
        api.runtimes['holdem'] = SimpleNamespace(snapshot=AsyncMock(return_value={'status':'finished', 'players':{'p0':{},'p1':{}}}))
        joined = await api.join_room(r.data['id'], api.Profile(player_id='late',name='新朋友',avatar='🐸'))
        self.assertIn('late',joined['members'])
        self.assertNotIn('late',joined['session_members'])
        self.assertEqual(joined['stage'],'finished')

    async def test_invalid_configuration_does_not_reset_readiness(self):
        r=await self.prepared();r.ready('p0',True,r.data['revision']);await api.save(r)
        with self.assertRaises(HTTPException):await api.select_game(r.data['id'],api.SelectGame(player_id='p0',game_id='holdem',options={'sb_amount':0}))
        self.assertTrue((await api.load(r.data['id'])).data['members']['p0']['ready'])
