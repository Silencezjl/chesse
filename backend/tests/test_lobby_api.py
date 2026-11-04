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
