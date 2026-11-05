import asyncio
import unittest
from unittest.mock import AsyncMock

from games.holdem.ws_manager import ConnectionManager
from lobby import api


class DeliveryTest(unittest.IsolatedAsyncioTestCase):
    async def test_holdem_delivery_is_ordered_and_does_not_wait_for_slow_client(self):
        manager = ConnectionManager()
        blocked = asyncio.Event()
        release = asyncio.Event()
        messages = []

        async def send(message):
            messages.append(message)
            if len(messages) == 1:
                blocked.set()
                await release.wait()

        ws = AsyncMock()
        ws.send_json.side_effect = send
        await manager.connect('room', 'player', ws)
        await manager.broadcast('room', {'n': 1})
        await blocked.wait()
        await asyncio.wait_for(manager.broadcast('room', {'n': 2}), timeout=.1)
        self.assertEqual(messages, [{'n': 1}])
        release.set()
        for _ in range(10):
            if len(messages) == 2:
                break
            await asyncio.sleep(.01)
        self.assertEqual(messages, [{'n': 1}, {'n': 2}])
        manager.disconnect('room', 'player')

    async def test_lobby_coalesces_pending_snapshots(self):
        blocked = asyncio.Event()
        release = asyncio.Event()
        messages = []

        async def send(message):
            messages.append(message)
            if len(messages) == 1:
                blocked.set()
                await release.wait()

        ws = AsyncMock()
        ws.send_json.side_effect = send
        api.queue_state(ws, {'n': 1})
        await blocked.wait()
        api.queue_state(ws, {'n': 2})
        api.queue_state(ws, {'n': 3})
        release.set()
        for _ in range(10):
            if len(messages) == 2:
                break
            await asyncio.sleep(.01)
        self.assertEqual(messages, [{'n': 1}, {'n': 3}])
