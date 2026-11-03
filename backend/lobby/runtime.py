"""Runtime adapters isolate game lifecycle and persistence from shared rooms."""
from typing import Protocol

from game import Room as CheeseRoom
from games.holdem.models import Room as HoldemRoom
from games.holdem.redis_manager import get_room as get_holdem, save_room as save_holdem, delete_room as delete_holdem
from games.holdem.ws_manager import manager as holdem_connections


class GameRuntime(Protocol):
    async def snapshot(self, room_id: str) -> dict | None: ...
    async def install(self, data: dict) -> None: ...
    async def detach(self, data: dict) -> None: ...
    async def reset_presence(self, room_id: str) -> None: ...


class CheeseRuntime:
    def __init__(self, manager, store, sockets, player_map):
        self.manager, self.store, self.sockets, self.player_map = manager, store, sockets, player_map

    async def snapshot(self, room_id):
        game = self.manager.get_room(room_id)
        return game.serialize() if game else None

    async def install(self, data):
        game = CheeseRoom.deserialize(data['game_state'])
        for pid, member in {**game.players, **game.spectators}.items():
            member.connected = data['members'][pid]['connected']
            self.player_map[pid] = data['id']
        self.manager.rooms[data['id']] = game
        await self.store.save_room(game.serialize())

    async def detach(self, data):
        room_id = data['id']
        self.manager.rooms.pop(room_id, None)
        for pid in data['members']:
            self.player_map.pop(pid, None)
            socket = self.sockets.pop(pid, None)
            if socket:
                await socket.close(code=1000)
            await self.store.remove_player_room(pid)
        await self.store.delete_room(room_id)

    async def reset_presence(self, room_id):
        # Cheese player deserialization already marks every player disconnected.
        return None


class HoldemRuntime:
    async def snapshot(self, room_id):
        game = await get_holdem(room_id)
        return game.model_dump(mode='json') if game else None

    async def install(self, data):
        await save_holdem(HoldemRoom.model_validate(data['game_state']))

    async def detach(self, data):
        room_id = data['id']
        sockets = holdem_connections.rooms.pop(room_id, {})
        for socket in sockets.values():
            await socket.close(code=1000)
        await delete_holdem(room_id)

    async def reset_presence(self, room_id):
        game = await get_holdem(room_id)
        if game:
            for player in game.players.values():
                player.is_connected = False
            await save_holdem(game)
