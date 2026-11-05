import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from lobby import api
from lobby.rooms import LobbyRoom
from test_lobby_api import MemoryRedis


class RoomCleanupTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        api.locks.clear();api.connections.clear();api.transitions.clear()
        api.redis=MemoryRedis()
        self.runtime=SimpleNamespace(has_connections=lambda _:False,detach=AsyncMock(),reset_presence=AsyncMock())
        api.runtimes={key:self.runtime for key in ('cheese','holdem','bluff')}

    async def asyncTearDown(self):
        await api.stop_cleanup()
        for tasks in (api.countdowns,api.owner_timers):
            for rid in list(tasks):api.cancel_task(tasks,rid)
        await asyncio.sleep(0)

    async def room(self,rid='123456',stage='waiting',game=None):
        r=LobbyRoom(rid,'p'+rid,'房主','🐭')
        r.data.update(stage=stage,game_id=game,session_id='session' if game else None)
        r.data['members']['p'+rid]['connected']=False
        with patch.object(api.time,'time',return_value=100):
            await api.save(r,add_player='p'+rid)
        return r

    async def test_all_stages_expire_only_at_the_deadline(self):
        for index,stage in enumerate(('choosing','waiting','countdown','playing','finished')):
            rid=str(100000+index);await self.room(rid,stage)
            await api.cleanup_empty_rooms(999)
            self.assertTrue(await api.db().exists(api.PREFIX+rid))
            await api.cleanup_empty_rooms(1000)
            self.assertFalse(await api.db().exists(api.PREFIX+rid))
            self.assertIsNone(await api.db().get(api.PLAYER_PREFIX+'p'+rid))
            self.assertNotIn(rid,await api.db().smembers(api.ROOMS_KEY))

    async def test_reconnect_clears_countdown_and_next_disconnect_starts_fresh(self):
        r=await self.room();pid='p123456'
        r.data['members'][pid]['connected']=True
        await api.save(r)
        self.assertIsNone((await api.load(r.data['id'])).data['empty_since'])
        await api.cleanup_empty_rooms(5000)
        self.assertTrue(await api.db().exists(api.PREFIX+r.data['id']))
        r.disconnect(pid)
        with patch.object(api.time,'time',return_value=5000):await api.save(r)
        await api.cleanup_empty_rooms(5899)
        self.assertTrue(await api.db().exists(api.PREFIX+r.data['id']))
        await api.cleanup_empty_rooms(5900)
        self.assertFalse(await api.db().exists(api.PREFIX+r.data['id']))

    async def test_game_connection_protects_room_without_a_lobby_connection(self):
        for game in ('cheese','holdem','bluff'):
            r=await self.room(game=game,stage='playing')
            self.runtime.has_connections=lambda _:True
            await api.cleanup_empty_rooms(1000)
            self.assertIsNone((await api.load(r.data['id'])).data['empty_since'])
            self.runtime.detach.assert_not_awaited()
            self.runtime.has_connections=lambda _:False
            await api.cleanup_empty_rooms(1100)
            self.assertEqual((await api.load(r.data['id'])).data['empty_since'],1100)
            await api.cleanup_empty_rooms(2000)
            self.assertFalse(await api.db().exists(api.PREFIX+r.data['id']))
            self.runtime.detach.reset_mock()

    async def test_restart_preserves_offline_timestamp_and_grants_online_rooms_grace(self):
        offline=await self.room('111111');online=await self.room('222222')
        online.data['members']['p222222']['connected']=True
        await api.save(online)
        with patch.object(api.time,'time',return_value=700):await api.reset_presence()
        self.assertEqual((await api.load(offline.data['id'])).data['empty_since'],100)
        self.assertEqual((await api.load(online.data['id'])).data['empty_since'],700)
        await api.cleanup_empty_rooms(1000)
        self.assertFalse(await api.db().exists(api.PREFIX+'111111'))
        self.assertTrue(await api.db().exists(api.PREFIX+'222222'))

    async def test_cleanup_is_scoped_and_preserves_new_player_mapping(self):
        await self.room(game='bluff',stage='playing')
        api.redis.values.update({'old-project:room:123456':'keep',api.PLAYER_PREFIX+'p123456':'another-room'})
        await api.cleanup_empty_rooms(1000)
        self.runtime.detach.assert_awaited_once()
        self.assertEqual(await api.db().get('old-project:room:123456'),'keep')
        self.assertEqual(await api.db().get(api.PLAYER_PREFIX+'p123456'),'another-room')
        self.assertNotIn('123456',api.transitions)

    async def test_missing_index_and_one_failed_detach_do_not_block_other_rooms(self):
        await self.room('111111',game='bluff');await self.room('222222')
        api.redis.sets[api.ROOMS_KEY].add('missing')
        self.runtime.detach.side_effect=RuntimeError('storage unavailable')
        with self.assertLogs(api.logger,level='ERROR'):await api.cleanup_empty_rooms(1000)
        self.assertTrue(await api.db().exists(api.PREFIX+'111111'))
        self.assertFalse(await api.db().exists(api.PREFIX+'222222'))
        self.assertNotIn('missing',await api.db().smembers(api.ROOMS_KEY))
        self.runtime.detach.side_effect=None
        await api.cleanup_empty_rooms(1001)
        self.assertFalse(await api.db().exists(api.PREFIX+'111111'))

    async def test_legacy_room_gets_full_grace_and_tasks_are_cancelled(self):
        r=await self.room();old=r.snapshot();old.pop('empty_since')
        import json
        api.redis.values[api.PREFIX+r.data['id']]=json.dumps(old)
        await api.cleanup_empty_rooms(10000)
        self.assertEqual((await api.load(r.data['id'])).data['empty_since'],10000)
        api.owner_timers[r.data['id']]=asyncio.create_task(asyncio.sleep(100))
        api.countdowns[r.data['id']]=asyncio.create_task(asyncio.sleep(100))
        await api.cleanup_empty_rooms(10900)
        self.assertNotIn(r.data['id'],api.owner_timers)
        self.assertNotIn(r.data['id'],api.countdowns)

    async def test_cleanup_serializes_with_reconnect(self):
        r=await self.room()
        async with api.locks[r.data['id']]:
            task=asyncio.create_task(api.cleanup_empty_rooms(1000))
            await asyncio.sleep(0)
            r.data['members']['p123456']['connected']=True
            await api.save(r)
        await task
        self.assertTrue(await api.db().exists(api.PREFIX+r.data['id']))

    async def test_unresponsive_lobby_socket_is_marked_offline(self):
        r=await self.room()
        from lobby.identity import key
        api.db().values[key('token')] = 'p123456'
        ws=SimpleNamespace(cookies={'lobby_session':'token'},accept=AsyncMock(),close=AsyncMock(),send_json=AsyncMock())
        # Use a real cancellable receive to exercise the timeout and finally path.
        async def receive():await asyncio.sleep(100)
        ws.receive_json=receive
        with patch.object(api,'HEARTBEAT_TIMEOUT',.01):
            await api.room_socket(ws,r.data['id'],'p123456')
        ws.close.assert_awaited_once_with(code=4000)
        fresh=await api.load(r.data['id'])
        self.assertFalse(fresh.data['members']['p123456']['connected'])
        self.assertIsNotNone(fresh.data['empty_since'])
