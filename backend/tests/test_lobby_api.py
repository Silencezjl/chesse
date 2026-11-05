import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException
from lobby import api


class MemoryRedis:
    def __init__(self):
        self.values = {}
        self.sets = {}

    async def get(self, key): return self.values.get(key)
    async def exists(self, key): return key in self.values
    async def delete(self, key): self.values.pop(key, None)
    async def smembers(self, key): return self.sets.get(key, set())
    def pipeline(self): return Pipeline(self)


class Pipeline:
    def __init__(self, redis): self.redis, self.operations = redis, []
    def set(self, key, value): self.operations.append(('set', key, value)); return self
    def delete(self, key): self.operations.append(('delete', key, None)); return self
    def sadd(self, key, value): self.operations.append(('sadd', key, value)); return self
    def srem(self, key, value): self.operations.append(('srem', key, value)); return self
    async def execute(self):
        for kind, key, value in self.operations:
            if kind == 'set': self.redis.values[key] = value
            elif kind == 'delete': self.redis.values.pop(key, None)
            elif kind == 'sadd': self.redis.sets.setdefault(key, set()).add(value)
            elif kind == 'srem': self.redis.sets.setdefault(key, set()).discard(value)


class PublicRoomApiTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        api.locks.clear()
        api.connections.clear()
        api.transitions.clear()
        self.redis = MemoryRedis()
        api.configure(self.redis, MagicMock(), MagicMock(), {}, {})
        self.profile = api.Profile(player_id='p0', name='房主', avatar='🐭')

    async def test_concurrent_creation_cannot_duplicate_player_membership(self):
        results = await asyncio.gather(api.create_room(self.profile), api.create_room(self.profile), return_exceptions=True)
        rooms = [r for r in results if isinstance(r, dict)]
        errors = [r for r in results if isinstance(r, HTTPException)]
        self.assertEqual(len(rooms), 1)
        self.assertEqual(errors[0].status_code, 409)
        self.assertEqual(await self.redis.get(api.PLAYER_PREFIX + 'p0'), rooms[0]['id'])
        self.assertFalse(rooms[0]['members']['p0']['connected'])
        self.assertNotIn('game_state', rooms[0])

    async def test_room_locks_are_shared_while_waiting_and_released_afterwards(self):
        held = api.locks['room']
        async with held:
            self.assertIs(api.locks['room'], held)
            acquired = asyncio.Event()

            async def wait_for_lock():
                async with api.locks['room']:
                    acquired.set()

            task = asyncio.create_task(wait_for_lock())
            await asyncio.sleep(0)
            self.assertFalse(acquired.is_set())
        await task
        del held, task
        self.assertNotIn('room', api.locks)

    async def test_refresh_only_replies_to_requesting_socket(self):
        from starlette.websockets import WebSocketDisconnect

        data = await api.create_room(self.profile)
        other = AsyncMock()
        api.connections[data['id']]['other'] = other
        from lobby.identity import key
        self.redis.values[key('token')] = 'p0'
        ws = MagicMock()
        ws.cookies = {'lobby_session': 'token'}
        ws.accept = AsyncMock()
        ws.send_json = AsyncMock()
        ws.receive_json = AsyncMock(side_effect=[{'type': 'refresh'}, WebSocketDisconnect()])
        await api.room_socket(ws, data['id'], 'p0')
        await asyncio.sleep(.01)
        # The other socket receives only connection and disconnection updates.
        self.assertLessEqual(other.send_json.await_count, 2)
        self.assertGreaterEqual(other.send_json.await_count, 1)
        self.assertGreaterEqual(ws.send_json.await_count, 1)

    async def test_directory_cache_is_invalidated_when_membership_changes(self):
        data = await api.create_room(self.profile)
        with unittest.mock.patch.object(api, 'build_room_list', wraps=api.build_room_list) as build:
            self.assertEqual((await api.list_rooms())[0]['count'], 1)
            self.assertEqual((await api.list_rooms())[0]['count'], 1)
            self.assertEqual(build.await_count, 1)
            await api.join_room(data['id'], api.Profile(player_id='p1', name='朋友', avatar='🐱'))
            self.assertEqual((await api.list_rooms())[0]['count'], 2)
            self.assertEqual(build.await_count, 2)

    async def test_disconnect_waiting_for_lock_does_not_mark_reconnected_player_offline(self):
        from starlette.websockets import WebSocketDisconnect
        from lobby.identity import key

        data = await api.create_room(self.profile)
        rid = data['id']
        self.redis.values[key('token')] = 'p0'
        ws = MagicMock(cookies={'lobby_session': 'token'})
        ws.accept = AsyncMock()
        ws.send_json = AsyncMock()
        replacement = AsyncMock()

        async def receive():
            lock = api.locks[rid]
            await lock.acquire()

            async def reconnect():
                await asyncio.sleep(0)
                api.connections[rid]['p0'] = replacement
                lock.release()

            asyncio.create_task(reconnect())
            raise WebSocketDisconnect()

        ws.receive_json = receive
        await api.room_socket(ws, rid, 'p0')
        self.assertTrue((await api.load(rid)).data['members']['p0']['connected'])
        self.assertIs(api.connections[rid]['p0'], replacement)

    async def test_unauthorized_leave_cannot_end_a_game(self):
        data = await api.create_room(self.profile)
        with self.assertRaises(HTTPException) as error:
            await api.leave_room(data['id'], {'player_id': 'not-a-member'})
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual((await api.load(data['id'])).data['owner_id'], 'p0')

    async def test_selecting_game_does_not_install_before_readiness(self):
        data = await api.create_room(self.profile)
        runtime = MagicMock()
        runtime.install = AsyncMock()
        api.runtimes['holdem'] = runtime
        selected = await api.select_game(data['id'], api.SelectGame(player_id='p0', game_id='holdem'))
        self.assertEqual(selected['stage'], 'waiting')
        self.assertEqual(selected['game_id'], 'holdem')
        runtime.install.assert_not_awaited()
