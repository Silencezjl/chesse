from __future__ import annotations
import json
from typing import Optional
from fastapi import WebSocket


class ConnectionManager:
    """Manage WebSocket connections per room."""

    def __init__(self):
        # room_id -> {player_id -> WebSocket}
        self.rooms: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, room_id: str, player_id: str, ws: WebSocket):
        await ws.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = {}
        self.rooms[room_id][player_id] = ws

    def disconnect(self, room_id: str, player_id: str):
        if room_id in self.rooms:
            self.rooms[room_id].pop(player_id, None)
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def send_to_player(self, room_id: str, player_id: str, data: dict):
        ws = self.rooms.get(room_id, {}).get(player_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(room_id, player_id)

    async def broadcast(self, room_id: str, data: dict, exclude: Optional[str] = None):
        connections = self.rooms.get(room_id, {})
        dead = []
        for pid, ws in connections.items():
            if pid == exclude:
                continue
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(pid)
        for pid in dead:
            self.disconnect(room_id, pid)


manager = ConnectionManager()
