import random
import asyncio
import time
from typing import Optional
from models import Player, Role, GamePhase, generate_room_id

from night_info import NightInfoMixin
from night_actions import NightActionsMixin
from voting import VotingMixin
from action_log import ActionLogMixin
from room_state import RoomStateMixin
from serialization import SerializationMixin


class Room(NightInfoMixin, NightActionsMixin, VotingMixin, ActionLogMixin, RoomStateMixin, SerializationMixin):
    def __init__(self, room_id: str, creator_id: str):
        self.id = room_id
        self.players: dict[str, Player] = {}
        self.phase: GamePhase = GamePhase.WAITING
        self.thief_id: Optional[str] = None
        self.accomplice_id: Optional[str] = None
        self.cheese_location: Optional[str] = None  # None = center, player_id = stolen
        self.min_players = 5
        self.max_players = 8
        self.creator_id = creator_id
        self.day_timer_task: Optional[asyncio.Task] = None
        self.night_actions_done: set[str] = set()
        self.vote_results: dict[str, int] = {}
        self.voted_player_id: Optional[str] = None
        self.winner: Optional[str] = None  # "thief" or "mouse"
        self.accomplice_enabled: bool = True
        self.thief_see_all_dice: bool = True
        self.max_dice: int = 6
        self.discussion_seconds: int = 180
        self._broadcast_func = None
        self.night_info: dict[str, dict] = {}
        self.vote_requests: set[str] = set()
        self.player_order: list[str] = []  # shuffled display order
        self.all_disconnected_since: Optional[float] = None  # timestamp when all players disconnected
        # Outsider settings (which outsiders are enabled)
        self.outsider_drunk: bool = False         # 酒鬼鼠 🍻
        self.outsider_dodobird: bool = False      # 呆呆鸟 🐦
        self.outsider_tom_jerry: bool = False     # Tom & Jerry 🐱🐭
        # Hex skill settings (independent of outsiders)
        self.hex_time_warp: bool = False           # 时空错乱 ⏳ (was trickster)
        self.hex_perception_interference: bool = False  # 感知干涉 🌀 (was ratatouille)
        self.hex_retirement_account: bool = False  # 退休账户 💰
        self.hex_lethal_tempo: bool = False        # 致命节奏 🎵
        self.hex_handpicked: bool = False          # 精心挑选 🎯
        # Outsider game state
        self.outsider_type: Optional[str] = None  # "drunk" | "dodobird" | "tom_jerry"
        self.outsider_id: Optional[str] = None    # player id of the outsider (drunk/dodobird only)
        # Hex skill game state
        self.hex_type: Optional[str] = None       # "time_warp" | "perception_interference" | "retirement_account" | "lethal_tempo" | "handpicked"
        self.hex_target_id: Optional[str] = None  # player who has the hex skill
        self.poison_target_id: Optional[str] = None  # 感知干涉's poison target
        self.poison_fake_dice: Optional[int] = None    # fake dice value for poisoned player
        self.poison_mode: Optional[str] = None  # "wrong_time" or "wrong_info"
        self.swap_info: Optional[dict] = None     # 时空错乱 swap info {pid1, pid2, dice1, dice2}
        self.day_start_time: Optional[float] = None  # timestamp when day phase started (for lethal_tempo)
        self.handpicked_boost_target_id: Optional[str] = None  # who the handpicked player chose to boost
        self.hex_delayed: bool = False  # True if hex assignment is delayed until after accomplice is chosen
        self.drunk_accomplice_id: Optional[str] = None  # who drunk mouse chose as accomplice
        self.thief_raw_accomplice_id: Optional[str] = None  # who thief initially chose (before resolution)
        self.dodobird_id: Optional[str] = None    # player id of the dodobird
        self.dodobird_accomplice_id: Optional[str] = None  # who dodobird chose as fake accomplice
        # Tom & Jerry state
        self.tom_id: Optional[str] = None         # player id of Tom (assassin accomplice)
        self.jerry_id: Optional[str] = None       # player id of Jerry (merlin mouse)
        self.assassinate_target_id: Optional[str] = None  # who Tom chose to assassinate
        self.assassinate_used: bool = False        # whether Tom has used assassination
        self.assassinate_result: Optional[str] = None  # "success" | "fail" | None
        self.spectators: dict[str, Player] = {}  # players watching the game (joined mid-game)

    def update_disconnect_timer(self):
        """Update the all-disconnected timer."""
        any_connected = (
            any(p.connected for p in self.players.values()) or
            any(s.connected for s in self.spectators.values())
        )
        if not any_connected and (self.players or self.spectators):
            if self.all_disconnected_since is None:
                self.all_disconnected_since = time.time()
        else:
            self.all_disconnected_since = None

    def all_offline(self) -> bool:
        """Check if no one is connected in this room (players + spectators)."""
        if not self.players and not self.spectators:
            return True
        return not any(p.connected for p in self.players.values()) and \
               not any(s.connected for s in self.spectators.values())

    def is_stale(self, timeout: float = 900) -> bool:
        """Check if room should be dissolved (all disconnected for timeout seconds)."""
        if self.all_disconnected_since is None:
            return False
        return (time.time() - self.all_disconnected_since) >= timeout

    def add_player(self, player: Player) -> bool:
        if len(self.players) >= self.max_players:
            return False
        if self.phase != GamePhase.WAITING:
            return False
        self.players[player.id] = player
        return True

    def add_spectator(self, player: Player):
        """Add a player as spectator (joined mid-game)."""
        self.spectators[player.id] = player

    def remove_spectator(self, player_id: str):
        """Remove a spectator. Returns True if room should be deleted."""
        self.spectators.pop(player_id, None)
        if len(self.players) == 0 and len(self.spectators) == 0:
            return True
        return False

    def remove_player(self, player_id: str):
        if player_id in self.players:
            del self.players[player_id]
        elif player_id in self.spectators:
            del self.spectators[player_id]
        if len(self.players) == 0 and len(self.spectators) == 0:
            return True  # room should be deleted
        if self.creator_id == player_id:
            if self.players:
                self.creator_id = next(iter(self.players))
            elif self.spectators:
                self.creator_id = next(iter(self.spectators))
        return False

    def set_ready(self, player_id: str, ready: bool):
        if player_id in self.players:
            self.players[player_id].ready = ready

    def all_ready(self) -> bool:
        if len(self.players) < self.min_players:
            return False
        return all(p.ready for p in self.players.values())

    def start_game(self):
        player_ids = list(self.players.keys())
        random.shuffle(player_ids)

        # Shuffle display order for player list
        self.player_order = list(player_ids)
        random.shuffle(self.player_order)

        # Assign roles
        self.thief_id = player_ids[0]
        self.players[self.thief_id].role = Role.THIEF

        for pid in player_ids[1:]:
            self.players[pid].role = Role.MOUSE

        # Roll dice for everyone
        for p in self.players.values():
            p.dice = random.randint(1, self.max_dice)
            p.display_dice = p.dice  # default: display = actual

        # Thief automatically steals cheese
        self.cheese_location = self.thief_id

        # Reset
        self.accomplice_id = None
        self.night_actions_done = set()
        self.vote_results = {}
        self.voted_player_id = None
        self.winner = None
        self.night_info = {}
        self.outsider_type = None
        self.outsider_id = None
        self.hex_type = None
        self.hex_target_id = None
        self.poison_target_id = None
        self.poison_fake_dice = None
        self.poison_mode = None
        self.swap_info = None
        self.day_start_time = None
        self.handpicked_boost_target_id = None
        self.hex_delayed = False
        self.drunk_accomplice_id = None
        self.thief_raw_accomplice_id = None
        self.dodobird_id = None
        self.dodobird_accomplice_id = None
        self.tom_id = None
        self.jerry_id = None
        self.assassinate_target_id = None
        self.assassinate_used = False
        self.assassinate_result = None

        # Assign outsider (at most one per game: drunk, dodobird, or tom_jerry)
        self._assign_outsider()

        # Assign hex skill (independent of outsider: time_warp or perception_interference)
        self._assign_hex_skill()

        self.phase = GamePhase.NIGHT

        # Compute night info based on dice groups
        self.compute_night_info()

        # All players must manually click "end night" button, no auto-done


class GameManager:
    def __init__(self):
        self.rooms: dict[str, Room] = {}

    def create_room(self, creator: Player) -> Room:
        room_id = generate_room_id()
        while room_id in self.rooms:
            room_id = generate_room_id()
        room = Room(room_id, creator.id)
        room.add_player(creator)
        self.rooms[room_id] = room
        return room

    def get_room(self, room_id: str) -> Optional[Room]:
        return self.rooms.get(room_id)

    def remove_room(self, room_id: str):
        if room_id in self.rooms:
            del self.rooms[room_id]

    def find_player_room(self, player_id: str) -> Optional[Room]:
        for room in self.rooms.values():
            if player_id in room.players or player_id in room.spectators:
                return room
        return None

    def list_rooms(self) -> list[dict]:
        """Return list of all active rooms (including in-progress games for spectating)."""
        result = []
        for room in self.rooms.values():
            result.append(room.to_list_item())
        return result

    def cleanup_stale_rooms(self) -> list[str]:
        """Remove rooms where all players have been disconnected for 15+ minutes."""
        stale_ids = [rid for rid, room in self.rooms.items() if room.is_stale()]
        for rid in stale_ids:
            del self.rooms[rid]
        return stale_ids
