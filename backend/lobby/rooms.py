"""Common room state and transition rules, independent of transport and storage."""
from copy import deepcopy
import secrets
import string
import uuid

from .games import GAMES, GameAdapter


class RoomError(ValueError):
    pass


def new_id() -> str:
    return ''.join(secrets.choice(string.digits) for _ in range(6))


class LobbyRoom:
    def __init__(self, room_id: str, owner_id: str, name: str, avatar: str):
        self.data = {"id": room_id, "owner_id": owner_id,
                     "members": {owner_id: self._member(name, avatar)},
                     "game_id": None, "game_state": None}

    @staticmethod
    def _member(name: str, avatar: str) -> dict:
        name = name.strip()
        if not name or len(name) > 12 or not avatar or len(avatar) > 16:
            raise RoomError("请填写不超过 12 个字符的昵称和有效头像")
        return {"name": name, "avatar": avatar, "connected": True}

    @classmethod
    def restore(cls, data: dict) -> "LobbyRoom":
        obj = cls.__new__(cls)
        obj.data = deepcopy(data)
        return obj

    def snapshot(self) -> dict:
        return deepcopy(self.data)

    def join(self, player_id: str, name: str, avatar: str):
        if player_id in self.data["members"]:
            self.data["members"][player_id]["connected"] = True
            return
        if len(self.data["members"]) >= 12:
            raise RoomError("房间已满")
        game_id = self.data["game_id"]
        if game_id is not None and not GAMES[game_id].can_switch(self.data["game_state"]):
            raise RoomError("游戏进行期间暂不能加入房间")
        self.data["members"][player_id] = self._member(name, avatar)

    def disconnect(self, player_id: str):
        if player_id in self.data["members"]:
            self.data["members"][player_id]["connected"] = False

    def leave(self, player_id: str):
        if player_id not in self.data["members"]:
            raise RoomError("你不在此房间中")
        if self.data["game_id"] is not None:
            raise RoomError("请先结束当前游戏")
        del self.data["members"][player_id]
        if player_id == self.data["owner_id"]:
            self.data["owner_id"] = next(iter(self.data["members"]), None)

    def select_game(self, player_id: str, game_id: str, options: dict,
                    registry: dict[str, GameAdapter] = GAMES):
        if player_id != self.data["owner_id"]:
            raise RoomError("只有房主可以选择游戏")
        if game_id not in registry:
            raise RoomError("未知游戏")
        current = self.data["game_id"]
        if current is not None:
            if current not in registry or not registry[current].can_switch(self.data["game_state"]):
                raise RoomError("当前游戏尚未结束")
        try:
            snapshot = registry[game_id].create(self.snapshot(), options)
        except ValueError as exc:
            raise RoomError(str(exc)) from exc
        self.data["game_id"] = game_id
        self.data["game_state"] = snapshot
        self.data["session_id"] = uuid.uuid4().hex
