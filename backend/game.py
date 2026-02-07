import random
import asyncio
import time
from typing import Optional
from models import Player, Role, GamePhase, generate_room_id


class Room:
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
        self.all_disconnected_since: Optional[float] = None  # timestamp when all players disconnected

    def update_disconnect_timer(self):
        """Update the all-disconnected timer."""
        any_connected = any(p.connected for p in self.players.values())
        if not any_connected and self.players:
            if self.all_disconnected_since is None:
                self.all_disconnected_since = time.time()
        else:
            self.all_disconnected_since = None

    def is_stale(self, timeout: float = 900) -> bool:
        """Check if room should be dissolved (all disconnected for timeout seconds)."""
        if self.all_disconnected_since is None:
            return False
        return (time.time() - self.all_disconnected_since) >= timeout

    def to_list_item(self) -> dict:
        """Return a summary dict for room listing."""
        connected_count = sum(1 for p in self.players.values() if p.connected)
        return {
            "room_id": self.id,
            "player_count": len(self.players),
            "connected_count": connected_count,
            "max_players": self.max_players,
            "phase": self.phase,
            "creator_name": self.players[self.creator_id].name if self.creator_id in self.players else "",
            "thief_see_all_dice": self.thief_see_all_dice,
            "max_dice": self.max_dice,
        }

    def add_player(self, player: Player) -> bool:
        if len(self.players) >= self.max_players:
            return False
        if self.phase != GamePhase.WAITING:
            return False
        self.players[player.id] = player
        return True

    def remove_player(self, player_id: str):
        if player_id in self.players:
            del self.players[player_id]
        if len(self.players) == 0:
            return True  # room should be deleted
        if self.creator_id == player_id and self.players:
            self.creator_id = next(iter(self.players))
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

        # Assign roles
        self.thief_id = player_ids[0]
        self.players[self.thief_id].role = Role.THIEF

        for pid in player_ids[1:]:
            self.players[pid].role = Role.MOUSE

        # Roll dice for everyone
        for p in self.players.values():
            p.dice = random.randint(1, self.max_dice)

        # Thief automatically steals cheese
        self.cheese_location = self.thief_id

        # Reset
        self.accomplice_id = None
        self.night_actions_done = set()
        self.vote_results = {}
        self.voted_player_id = None
        self.winner = None
        self.night_info = {}

        self.phase = GamePhase.NIGHT

        # Compute night info based on dice groups
        self.compute_night_info()

        # Auto-mark mice who can't peek (in a group) as night done
        for pid, info in self.night_info.items():
            if self.players[pid].role != Role.THIEF and not info.get("can_peek"):
                self.night_actions_done.add(pid)

    def compute_night_info(self):
        """Compute night phase info for each player based on dice groups."""
        # Group players by dice value
        dice_groups: dict[int, list[str]] = {}
        for pid, player in self.players.items():
            dice_groups.setdefault(player.dice, []).append(pid)

        thief_dice = self.players[self.thief_id].dice

        for pid, player in self.players.items():
            group = dice_groups[player.dice]
            info = {
                "role": player.role,
                "dice": player.dice,
                "phase": "night",
            }

            if player.role == Role.THIEF:
                if self.thief_see_all_dice:
                    info["all_dice"] = {p_id: p.dice for p_id, p in self.players.items()}
                    info["message"] = "你是奶酪大盗！你已经偷走了奶酪🧀。你可以查看所有人的骰子点数。"
                    info["same_group"] = []
                else:
                    # Show same-group players to thief (like mice do)
                    same_group_ids = [g for g in group if g != pid]
                    if same_group_ids:
                        group_members = []
                        for gid in same_group_ids:
                            gp = self.players[gid]
                            group_members.append({"id": gid, "name": gp.name, "avatar": gp.avatar})
                        info["same_group"] = group_members
                        names = "、".join(self.players[gid].name for gid in same_group_ids)
                        info["message"] = f"你是奶酪大盗！你已经偷走了奶酪🧀。你和 {names} 同时睁眼了。"
                    else:
                        info["same_group"] = []
                        info["message"] = "你是奶酪大盗！你已经偷走了奶酪🧀。你独自睁眼。"
                info["can_choose_accomplice"] = self.can_choose_accomplice()
                info["can_peek"] = False
            else:
                # Mouse: check dice group
                same_group_ids = [g for g in group if g != pid]
                is_alone = len(same_group_ids) == 0
                thief_in_group = self.thief_id in group

                if is_alone:
                    # Solo mouse: can peek at one other player's dice
                    info["can_peek"] = True
                    info["same_group"] = []
                    info["message"] = "你是瞌睡鼠，你独自睁眼。你可以偷看一位玩家的骰子点数。"
                    # If thief acted before this dice value, cheese is gone
                    if thief_dice < player.dice:
                        info["cheese_stolen"] = True
                        info["message"] += "\n⚠️ 你发现奶酪已经被偷走了！"
                    else:
                        info["message"] += "\n✅ 奶酪还在，没有被偷走。"
                else:
                    # Multiple players share dice value: open eyes together
                    info["can_peek"] = False
                    group_members = []
                    for gid in same_group_ids:
                        gp = self.players[gid]
                        entry = {"id": gid, "name": gp.name, "avatar": gp.avatar}
                        if gp.role == Role.THIEF:
                            entry["is_thief"] = True
                        group_members.append(entry)
                    info["same_group"] = group_members

                    if thief_in_group:
                        # Thief is in the same group: mice see the thief stealing
                        info["thief_spotted"] = True
                        thief_player = self.players[self.thief_id]
                        info["spotted_thief_name"] = thief_player.name
                        info["message"] = f"你是瞌睡鼠。你和其他玩家同时睁眼，你发现 {thief_player.name} 正在偷奶酪！🧀"
                    else:
                        names = "、".join(self.players[gid].name for gid in same_group_ids)
                        info["message"] = f"你是瞌睡鼠。你和 {names} 同时睁眼了，你们互相确认都是好老鼠🐭。"
                        if thief_dice < player.dice:
                            info["cheese_stolen"] = True
                            info["message"] += "\n⚠️ 你们发现奶酪已经被偷走了！"
                        else:
                            info["message"] += "\n✅ 奶酪还在，没有被偷走。"

            self.night_info[pid] = info

    def can_choose_accomplice(self) -> bool:
        return self.accomplice_enabled

    def must_choose_accomplice(self) -> bool:
        return self.accomplice_enabled

    def thief_can_finish_night(self) -> bool:
        """Thief must choose accomplice before finishing night."""
        if self.must_choose_accomplice() and self.accomplice_id is None:
            return False
        return True

    def all_actions_complete(self) -> bool:
        """Check if all players who have night actions have completed them."""
        # Thief must have chosen accomplice
        if self.must_choose_accomplice() and self.accomplice_id is None:
            return False
        # All mice that can peek must have peeked
        for pid, night in self.night_info.items():
            if night.get("can_peek") and not night.get("has_peeked"):
                return False
        return True

    def can_end_night(self, player_id: str) -> bool:
        """Check if a player can click 'end night'.
        Conditions:
        1. Player's own action is complete (mouse peeked if can_peek; thief chose accomplice)
        2. All players' actions must be complete (global wait condition)
        """
        player = self.players.get(player_id)
        if not player:
            return False

        # Per-player: own action must be done first
        if player.role == Role.THIEF:
            if self.must_choose_accomplice() and self.accomplice_id is None:
                return False
        else:
            night = self.night_info.get(player_id, {})
            if night.get("can_peek") and not night.get("has_peeked"):
                return False

        # Global: all players' actions must be complete
        if not self.all_actions_complete():
            return False

        return True

    def choose_accomplice(self, thief_id: str, target_id: str) -> bool:
        if thief_id != self.thief_id:
            return False
        if target_id == thief_id:
            return False
        if target_id not in self.players:
            return False
        self.accomplice_id = target_id
        self.players[target_id].is_accomplice = True
        self.players[target_id].role = Role.ACCOMPLICE

        # Update night_info for accomplice
        thief = self.players[thief_id]
        if target_id in self.night_info:
            self.night_info[target_id].update({
                "role": "accomplice",
                "is_accomplice": True,
                "thief_id": thief_id,
                "thief_name": thief.name,
                "thief_dice": thief.dice,
                "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。",
            })
        # Update thief's night_info
        accomplice = self.players[target_id]
        if thief_id in self.night_info:
            self.night_info[thief_id]["accomplice_id"] = target_id
            self.night_info[thief_id]["accomplice_name"] = accomplice.name
            self.night_info[thief_id]["can_choose_accomplice"] = False

        return True

    def peek_dice(self, player_id: str, target_id: str) -> Optional[int]:
        player = self.players.get(player_id)
        if not player:
            return None
        if player.role == Role.THIEF:
            return None
        # Check can_peek from night_info (dice group rule)
        night = self.night_info.get(player_id, {})
        if not night.get("can_peek"):
            return None
        if player.has_peeked:
            return None
        if target_id not in self.players or target_id == player_id:
            return None

        target = self.players[target_id]
        player.has_peeked = True
        player.peek_target = target_id
        player.peek_result = target.dice
        self.night_actions_done.add(player_id)

        # Update night_info with peek result
        self.night_info[player_id]["has_peeked"] = True
        self.night_info[player_id]["peek_target"] = target_id
        self.night_info[player_id]["peek_target_name"] = target.name
        self.night_info[player_id]["peek_result"] = target.dice

        return target.dice

    def mark_night_done(self, player_id: str):
        self.night_actions_done.add(player_id)

    def all_night_actions_done(self) -> bool:
        for pid, player in self.players.items():
            if not player.connected:
                continue
            if pid not in self.night_actions_done:
                return False
        return True

    def start_day(self):
        self.phase = GamePhase.DAY
        self.vote_requests = set()

    def add_vote_request(self, player_id: str):
        self.vote_requests.add(player_id)

    def vote_request_count(self) -> int:
        return len(self.vote_requests)

    def vote_request_required(self) -> int:
        connected = sum(1 for p in self.players.values() if p.connected)
        return connected // 2 + 1

    def start_voting(self):
        self.phase = GamePhase.VOTING
        for p in self.players.values():
            p.voted_for = None

    def cast_vote(self, voter_id: str, target_id: str) -> tuple[bool, str]:
        voter = self.players.get(voter_id)
        if not voter or target_id not in self.players:
            return False, "无效的投票目标"
        # Cannot change vote once cast
        if voter.voted_for is not None:
            return False, "你已经投过票了，不能改票"
        # Accomplice cannot vote for thief
        if voter.is_accomplice and target_id == self.thief_id:
            return False, "作为共犯，你不能给奶酪大盗投票"
        voter.voted_for = target_id
        return True, ""

    def all_voted(self) -> bool:
        for p in self.players.values():
            if p.voted_for is None:
                return False
        return True

    def build_action_log(self) -> list[dict]:
        """Build a chronological summary of all players' night actions."""
        log = []
        # Group by dice value for ordering
        dice_groups: dict[int, list[str]] = {}
        for pid, player in self.players.items():
            dice_groups.setdefault(player.dice, []).append(pid)

        for dice_val in sorted(dice_groups.keys()):
            pids = dice_groups[dice_val]
            for pid in pids:
                player = self.players[pid]
                night = self.night_info.get(pid, {})
                entry = {
                    "player_id": pid,
                    "name": player.name,
                    "avatar": player.avatar,
                    "role": player.role,
                    "dice": player.dice,
                    "actions": [],
                }

                if player.role == Role.THIEF:
                    entry["actions"].append("🧀 偷走了奶酪")
                    if self.accomplice_id:
                        acc = self.players[self.accomplice_id]
                        entry["actions"].append(f"🤝 选择了 {acc.name} 作为共犯")
                elif player.is_accomplice:
                    thief = self.players[self.thief_id]
                    entry["actions"].append(f"🤝 被 {thief.name} 选为共犯")
                else:
                    same_group = night.get("same_group", [])
                    if same_group:
                        names = "、".join(m["name"] for m in same_group)
                        entry["actions"].append(f"👀 与 {names} 同时睁眼")
                        if night.get("thief_spotted"):
                            entry["actions"].append(f"🚨 发现了大盗 {night.get('spotted_thief_name')}")
                    if night.get("has_peeked"):
                        entry["actions"].append(f"🔍 偷看了 {night.get('peek_target_name')} 的骰子: {night.get('peek_result')} 点")
                    elif night.get("can_peek") and not night.get("has_peeked"):
                        entry["actions"].append("❌ 未偷看任何人")
                    if night.get("cheese_stolen"):
                        entry["actions"].append("⚠️ 发现奶酪被偷")

                # Vote info
                if player.voted_for:
                    target = self.players.get(player.voted_for)
                    if target:
                        entry["actions"].append(f"🗳️ 投票给了 {target.name}")

                log.append(entry)
        return log

    def tally_votes(self) -> dict:
        tally: dict[str, int] = {}
        for p in self.players.values():
            if p.voted_for:
                tally[p.voted_for] = tally.get(p.voted_for, 0) + 1

        self.vote_results = tally

        if not tally:
            self.voted_player_id = None
            self.winner = "thief"
        else:
            max_votes = max(tally.values())
            top = [pid for pid, v in tally.items() if v == max_votes]
            self.voted_player_id = top[0]  # tie: first one

            if self.voted_player_id == self.thief_id:
                self.winner = "mouse"
            else:
                self.winner = "thief"

        self.phase = GamePhase.RESULT

        action_log = self.build_action_log()

        return {
            "vote_results": tally,
            "voted_player_id": self.voted_player_id,
            "voted_player_name": self.players[self.voted_player_id].name if self.voted_player_id else None,
            "voted_player_is_thief": self.voted_player_id == self.thief_id,
            "winner": self.winner,
            "thief_id": self.thief_id,
            "thief_name": self.players[self.thief_id].name,
            "accomplice_id": self.accomplice_id,
            "accomplice_name": self.players[self.accomplice_id].name if self.accomplice_id else None,
            "players": {pid: p.to_dict(reveal=True) for pid, p in self.players.items()},
            "action_log": action_log,
        }

    def reset_for_new_game(self):
        self.phase = GamePhase.WAITING
        self.thief_id = None
        self.accomplice_id = None
        self.cheese_location = None
        self.night_actions_done = set()
        self.vote_results = {}
        self.voted_player_id = None
        self.winner = None
        self.night_info = {}
        self.vote_requests = set()
        for p in self.players.values():
            p.reset_game_state()

    def get_room_state(self, for_player_id: str = None) -> dict:
        players_data = {}
        for pid, p in self.players.items():
            is_self = (pid == for_player_id)
            reveal = (self.phase == GamePhase.RESULT)
            players_data[pid] = p.to_dict(reveal=reveal, is_self=is_self)

        data = {
            "room_id": self.id,
            "phase": self.phase,
            "player_count": len(self.players),
            "min_players": self.min_players,
            "max_players": self.max_players,
            "players": players_data,
            "creator_id": self.creator_id,
            "thief_see_all_dice": self.thief_see_all_dice,
            "max_dice": self.max_dice,
        }

        # Include personalized game info for all active game phases (Bug3: survives refresh)
        if for_player_id and self.phase != GamePhase.WAITING:
            player = self.players.get(for_player_id)
            if player:
                my_info = {
                    "role": player.role,
                    "dice": player.dice,
                    "is_accomplice": player.is_accomplice,
                }
                if self.phase == GamePhase.NIGHT:
                    night = self.night_info.get(for_player_id, {})
                    my_info.update(night)
                    my_info["can_end_night"] = self.can_end_night(for_player_id)
                    my_info["i_night_done"] = for_player_id in self.night_actions_done
                data["my_info"] = my_info

        if self.phase == GamePhase.NIGHT:
            connected_count = sum(1 for p in self.players.values() if p.connected)
            data["night_done_count"] = len(self.night_actions_done)
            data["night_total"] = connected_count

        if self.phase == GamePhase.DAY:
            data["vote_request_count"] = self.vote_request_count()
            data["vote_request_required"] = self.vote_request_required()
            if for_player_id:
                data["i_requested_vote"] = for_player_id in self.vote_requests

        if self.phase == GamePhase.VOTING:
            voted_count = sum(1 for p in self.players.values() if p.voted_for is not None)
            data["voted_count"] = voted_count
            data["total_voters"] = sum(1 for p in self.players.values() if p.connected)

        if self.phase == GamePhase.VOTING:
            # Accomplice needs to know thief_id to disable voting
            if for_player_id:
                p = self.players.get(for_player_id)
                if p and p.is_accomplice:
                    data["no_vote_target"] = self.thief_id

        if self.phase == GamePhase.RESULT:
            data["vote_results"] = self.vote_results
            data["voted_player_id"] = self.voted_player_id
            data["winner"] = self.winner
            data["thief_id"] = self.thief_id
            data["accomplice_id"] = self.accomplice_id
            data["action_log"] = self.build_action_log()

        return data


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
            if player_id in room.players:
                return room
        return None

    def list_rooms(self) -> list[dict]:
        """Return list of joinable rooms (waiting phase, not full)."""
        result = []
        for room in self.rooms.values():
            if room.phase == GamePhase.WAITING and len(room.players) < room.max_players:
                result.append(room.to_list_item())
        return result

    def cleanup_stale_rooms(self) -> list[str]:
        """Remove rooms where all players have been disconnected for 15+ minutes."""
        stale_ids = [rid for rid, room in self.rooms.items() if room.is_stale()]
        for rid in stale_ids:
            del self.rooms[rid]
        return stale_ids
