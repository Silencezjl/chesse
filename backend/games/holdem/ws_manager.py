from __future__ import annotations

import asyncio
from typing import Optional
from fastapi import WebSocket


class ConnectionManager:
    """Deliver ordered game events without waiting on a slow connection."""

    def __init__(self):
        self.rooms: dict[str, dict[str, WebSocket]] = {}
        self.queues: dict[int, asyncio.Queue] = {}
        self.senders: dict[int, asyncio.Task] = {}

    async def connect(self, room_id: str, player_id: str, ws: WebSocket):
        await ws.accept()
        previous = self.rooms.setdefault(room_id, {}).get(player_id)
        self.rooms[room_id][player_id] = ws
        self.queues[id(ws)] = asyncio.Queue(maxsize=64)
        self.senders[id(ws)] = asyncio.create_task(self._sender(ws))
        if previous and previous is not ws:
            self._stop_sender(previous)
            await previous.close(code=4001)

    def _stop_sender(self, ws: WebSocket):
        task = self.senders.pop(id(ws), None)
        self.queues.pop(id(ws), None)
        if task and task is not asyncio.current_task():
            task.cancel()

    def disconnect(self, room_id: str, player_id: str):
        room = self.rooms.get(room_id)
        if room:
            ws = room.pop(player_id, None)
            if ws:
                self._stop_sender(ws)
            if not room:
                self.rooms.pop(room_id, None)

    async def _sender(self, ws: WebSocket):
        try:
            queue = self.queues[id(ws)]
            while True:
                message = await queue.get()
                await asyncio.wait_for(ws.send_json(message), timeout=2)
        except asyncio.CancelledError:
            pass
        except Exception:
            try:
                await asyncio.wait_for(ws.close(code=1011), timeout=1)
            except Exception:
                pass
        finally:
            self.queues.pop(id(ws), None)
            self.senders.pop(id(ws), None)

    def _enqueue(self, ws: WebSocket, data: dict):
        queue = self.queues.get(id(ws))
        if queue:
            try:
                queue.put_nowait(data)
            except asyncio.QueueFull:
                self._stop_sender(ws)
                asyncio.create_task(self._close_slow_client(ws))

    async def _close_slow_client(self, ws: WebSocket):
        try:
            await asyncio.wait_for(ws.close(code=1011), timeout=1)
        except Exception:
            pass

    async def send_to_player(self, room_id: str, player_id: str, data: dict):
        ws = self.rooms.get(room_id, {}).get(player_id)
        if ws:
            self._enqueue(ws, data)

    async def broadcast(self, room_id: str, data: dict, exclude: Optional[str] = None):
        for pid, ws in list(self.rooms.get(room_id, {}).items()):
            if pid != exclude:
                self._enqueue(ws, data)


manager = ConnectionManager()
