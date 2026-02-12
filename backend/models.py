from pydantic import BaseModel
from typing import Optional
from enum import Enum
import random
import string


class GamePhase(str, Enum):
    WAITING = "waiting"
    NIGHT = "night"
    DAY = "day"
    VOTING = "voting"
    RESULT = "result"


class Role(str, Enum):
    THIEF = "thief"
    MOUSE = "mouse"
    ACCOMPLICE = "accomplice"
    DODOBIRD = "dodobird"


AVATARS = [
    "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
    "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦",
    "🐱", "🐶", "🐺", "🦝", "🦄", "🐲", "🦉", "🦅",
    "🐿️", "🦔", "🐾", "🐳", "🐬", "🦈", "🐙", "🦑",
    "🦋", "🐞", "🐝", "🦎", "🐢", "🐍", "🦩", "🦜",
    "🐏", "🦌", "🐘", "🦒", "🦘", "🐊", "🦀", "🐡",
]

NAMES = [
    "小白", "大黄", "阿花", "豆豆", "球球", "旺财", "小黑", "毛毛",
    "咪咪", "点点", "糖糖", "乐乐", "欢欢", "妞妞", "贝贝", "多多",
    "团团", "圆圆", "丁丁", "当当", "奇奇", "妙妙", "嘟嘟", "泡泡",
    "花花", "果果", "米粒", "芝麻", "年糕", "汤圆", "饺子", "包子",
    "薯条", "可乐", "奶茶", "布丁", "麻团", "芋头", "栗子", "核桃",
    "小鱼", "虾米", "螃蟹", "海星", "云朵", "星星", "月亮", "太阳",
]


def generate_room_id() -> str:
    return ''.join(random.choices(string.digits, k=6))


def random_name() -> str:
    return random.choice(NAMES) + str(random.randint(1, 99))


def random_avatar() -> str:
    return random.choice(AVATARS)


class Player:
    def __init__(self, player_id: str, name: str = "", avatar: str = ""):
        self.id = player_id
        self.name = name or random_name()
        self.avatar = avatar or random_avatar()
        self.role: Optional[Role] = None
        self.dice: int = 0
        self.display_dice: int = 0  # What the player thinks their dice is (may differ from actual if swapped)
        self.ready: bool = False
        self.connected: bool = True
        self.voted_for: Optional[str] = None
        self.has_peeked: bool = False
        self.peek_target: Optional[str] = None
        self.peek_result: Optional[int] = None
        self.is_accomplice: bool = False
        self.outsider: Optional[str] = None  # None, "ratatouille", "trickster", "drunk"

    def to_dict(self, reveal: bool = False, is_self: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "avatar": self.avatar,
            "ready": self.ready,
            "connected": self.connected,
        }
        if is_self or reveal:
            # Drunk mouse sees themselves as thief (except in reveal phase)
            if is_self and not reveal and self.outsider == "drunk":
                data["role"] = Role.THIEF
            else:
                data["role"] = self.role
            data["dice"] = self.dice if reveal else self.display_dice
            data["is_accomplice"] = self.is_accomplice
            if reveal and self.outsider:
                data["outsider"] = self.outsider
            if reveal and self.display_dice != self.dice:
                data["display_dice"] = self.display_dice
                data["actual_dice"] = self.dice
        if is_self:
            data["has_peeked"] = self.has_peeked
            data["peek_target"] = self.peek_target
            data["peek_result"] = self.peek_result
            data["voted_for"] = self.voted_for
        return data

    def reset_game_state(self):
        self.role = None
        self.dice = 0
        self.display_dice = 0
        self.ready = False
        self.voted_for = None
        self.has_peeked = False
        self.peek_target = None
        self.peek_result = None
        self.is_accomplice = False
        self.outsider = None

    def serialize(self) -> dict:
        """Serialize player state for Redis persistence."""
        return {
            "id": self.id,
            "name": self.name,
            "avatar": self.avatar,
            "role": self.role,
            "dice": self.dice,
            "display_dice": self.display_dice,
            "ready": self.ready,
            "connected": self.connected,
            "voted_for": self.voted_for,
            "has_peeked": self.has_peeked,
            "peek_target": self.peek_target,
            "peek_result": self.peek_result,
            "is_accomplice": self.is_accomplice,
            "outsider": self.outsider,
        }

    @classmethod
    def deserialize(cls, data: dict) -> "Player":
        """Restore player from serialized data."""
        p = cls(data["id"], data.get("name", ""), data.get("avatar", ""))
        p.role = data.get("role")
        p.dice = data.get("dice", 0)
        p.display_dice = data.get("display_dice", 0)
        p.ready = data.get("ready", False)
        p.connected = False  # always start disconnected on restore
        p.voted_for = data.get("voted_for")
        p.has_peeked = data.get("has_peeked", False)
        p.peek_target = data.get("peek_target")
        p.peek_result = data.get("peek_result")
        p.is_accomplice = data.get("is_accomplice", False)
        p.outsider = data.get("outsider")
        return p
