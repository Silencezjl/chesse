"""Game-specific initialization and switching rules.

A game adapter owns its snapshot; the lobby owns membership and room lifecycle.
"""
from typing import Protocol

from game import Room as CheeseRoom
from models import Player as CheesePlayer, GamePhase
from games.holdem.models import Room as HoldemRoom, Player as HoldemPlayer, RoomStatus


class GameAdapter(Protocol):
    id: str
    title: str

    def create(self, room: dict, options: dict) -> dict: ...
    def can_switch(self, snapshot: dict) -> bool: ...


class CheeseAdapter:
    id = "cheese"
    title = "奶酪大盗"

    def create(self, room: dict, options: dict) -> dict:
        selected = options.get("participants")
        if (not isinstance(selected, list) or any(not isinstance(pid, str) for pid in selected)
                or len(set(selected)) != len(selected)):
            raise ValueError("请选择不同的参与玩家")
        if not 5 <= len(selected) <= 8:
            raise ValueError("奶酪大盗需要 5–8 名参与玩家")
        members = room["members"]
        if any(pid not in members or not members[pid]["connected"] for pid in selected):
            raise ValueError("只能选择在线房间成员")
        dice = options.get("max_dice", 6)
        if not isinstance(dice, int) or isinstance(dice, bool) or not 6 <= dice <= 10:
            raise ValueError("骰子面数必须在 6 到 10 之间")
        game = CheeseRoom(room["id"], room["owner_id"])
        game.max_dice = dice
        game.outsider_dodobird = bool(options.get("outsider_dodobird", False))
        game.thief_see_all_dice = bool(options.get("thief_see_all_dice", True))
        for pid, member in members.items():
            player = CheesePlayer(pid, member["name"], member["avatar"])
            player.connected = member["connected"]
            if pid in selected:
                game.add_player(player)
            else:
                game.add_spectator(player)
        return game.serialize()

    def can_switch(self, snapshot: dict) -> bool:
        return snapshot.get("phase") == GamePhase.RESULT


class HoldemAdapter:
    id = "holdem"
    title = "Holdem 筹码"

    def create(self, room: dict, options: dict) -> dict:
        def integer(name, default, minimum, maximum):
            value = options.get(name, default)
            if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
                raise ValueError(f"{name} 的值无效")
            return value
        sb = integer("sb_amount", 10, 1, 1_000_000)
        chips = integer("initial_chips", 1000, 1, 1_000_000_000)
        rebuy = integer("rebuy_minimum", 0, 0, 1_000_000_000)
        interval = integer("hand_interval", 5, 0, 300)
        maximum = integer("max_chips", 0, 0, 1_000_000_000)
        members = {pid: HoldemPlayer(id=pid, name=p["name"], emoji=p["avatar"],
                                      chips=chips, is_connected=p["connected"])
                   for pid, p in room["members"].items()}
        return HoldemRoom(id=room["id"], owner_id=room["owner_id"], sb_amount=sb,
                          initial_chips=chips, rebuy_minimum=rebuy,
                          hand_interval=interval, max_chips=maximum,
                          players=members).model_dump(mode="json")

    def can_switch(self, snapshot: dict) -> bool:
        return snapshot.get("status") == RoomStatus.FINISHED


GAMES: dict[str, GameAdapter] = {game.id: game for game in (CheeseAdapter(), HoldemAdapter())}
