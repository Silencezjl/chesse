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
        # Outsider settings (which outsiders are enabled)
        self.outsider_ratatouille: bool = False  # 料理鼠王 🍳
        self.outsider_trickster: bool = False    # 鼠小弟 🧸
        self.outsider_drunk: bool = False         # 酒鬼鼠 🍺
        # Outsider game state
        self.outsider_type: Optional[str] = None  # which outsider is active this game
        self.outsider_id: Optional[str] = None    # player id of the outsider
        self.poison_target_id: Optional[str] = None  # 料理鼠王's poison target
        self.poison_fake_dice: Optional[int] = None    # fake dice value for poisoned player
        self.poison_mode: Optional[str] = None  # "wrong_time" or "wrong_info"
        self.swap_info: Optional[dict] = None     # 鼠小弟 swap info {pid1, pid2, dice1_orig, dice2_orig}
        self.drunk_accomplice_id: Optional[str] = None  # who drunk mouse chose as accomplice
        self.thief_raw_accomplice_id: Optional[str] = None  # who thief initially chose (before resolution)

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
            "outsiders": self._outsider_settings_list(),
        }

    def _outsider_settings_list(self) -> list[str]:
        """Return list of enabled outsider type strings."""
        result = []
        if self.outsider_ratatouille:
            result.append("ratatouille")
        if self.outsider_trickster:
            result.append("trickster")
        if self.outsider_drunk:
            result.append("drunk")
        return result

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
        self.poison_target_id = None
        self.poison_fake_dice = None
        self.poison_mode = None
        self.swap_info = None
        self.drunk_accomplice_id = None
        self.thief_raw_accomplice_id = None

        # Assign outsider (at most one per game)
        self._assign_outsider()

        self.phase = GamePhase.NIGHT

        # Compute night info based on dice groups
        self.compute_night_info()

        # Auto-mark players who have no actions as night done
        for pid, info in self.night_info.items():
            player = self.players[pid]
            # Drunk mouse must choose accomplice (if enabled), so not auto-done
            if player.outsider == "drunk":
                if self.accomplice_enabled:
                    continue
                else:
                    self.night_actions_done.add(pid)
                    continue
            # Thief must choose accomplice, not auto-done
            if player.role == Role.THIEF:
                continue
            # Trickster can't peek, auto-done
            if player.outsider == "trickster":
                self.night_actions_done.add(pid)
                continue
            # Mouse that can peek is not auto-done
            if info.get("can_peek"):
                continue
            # Mouse in group, no action needed
            self.night_actions_done.add(pid)

    def _assign_outsider(self):
        """Randomly assign one outsider from enabled types."""
        enabled = self._outsider_settings_list()
        if not enabled:
            return

        outsider_type = random.choice(enabled)
        self.outsider_type = outsider_type

        mouse_ids = [pid for pid in self.players if pid != self.thief_id]

        if outsider_type == "ratatouille":
            # Can be any player (thief or mouse)
            candidates = list(self.players.keys())
            self.outsider_id = random.choice(candidates)
            self.players[self.outsider_id].outsider = "ratatouille"
            # Poison a random other player
            others = [pid for pid in self.players if pid != self.outsider_id]
            self.poison_target_id = random.choice(others)
            # Generate a fake dice value different from the target's real dice
            target_player = self.players[self.poison_target_id]
            possible_dice = [d for d in range(1, self.max_dice + 1) if d != target_player.dice]
            self.poison_fake_dice = random.choice(possible_dice)
            # Randomly choose poison mode
            self.poison_mode = random.choice(["wrong_time", "wrong_info"])
            if self.poison_mode == "wrong_time":
                # Wrong time: player sees fake dice value
                target_player.display_dice = self.poison_fake_dice
            # wrong_info: display_dice stays real, player wakes at correct time

        elif outsider_type == "trickster":
            # Can be any player (thief or mouse)
            candidates = list(self.players.keys())
            self.outsider_id = random.choice(candidates)
            self.players[self.outsider_id].outsider = "trickster"
            # Swap two random players' dice (can include self)
            all_pids = list(self.players.keys())
            swap_pair = random.sample(all_pids, 2)
            p1, p2 = self.players[swap_pair[0]], self.players[swap_pair[1]]
            # Record original dice before swap
            self.swap_info = {
                "pid1": swap_pair[0], "pid2": swap_pair[1],
                "dice1_orig": p1.dice, "dice2_orig": p2.dice,
            }
            # Swap actual dice (used for wake order)
            p1.dice, p2.dice = p2.dice, p1.dice
            # display_dice stays as original (players think they have original dice)
            # p1.display_dice and p2.display_dice were set to original values above

        elif outsider_type == "drunk":
            # Must be a mouse (not the thief)
            if len(mouse_ids) < 2:
                # Need at least 2 mice (one for drunk, one for real accomplice)
                self.outsider_type = None
                return
            self.outsider_id = random.choice(mouse_ids)
            self.players[self.outsider_id].outsider = "drunk"

    def compute_night_info(self):
        """Compute night phase info for each player based on dice groups."""
        # Drunk mouse is excluded from dice wake order (sleeps all night)
        drunk_id = self.outsider_id if self.outsider_type == "drunk" else None
        # Poisoned player: only excluded from normal grouping in wrong_time mode
        poison_pid = self.poison_target_id if self.outsider_type == "ratatouille" else None
        poison_exclude = poison_pid if self.poison_mode == "wrong_time" else None

        # Group players by actual dice value
        dice_groups: dict[int, list[str]] = {}
        for pid, player in self.players.items():
            if pid == drunk_id:
                continue  # drunk mouse doesn't wake up
            if pid == poison_exclude:
                continue  # wrong_time: poisoned player grouped separately
            dice_groups.setdefault(player.dice, []).append(pid)

        thief_dice = self.players[self.thief_id].dice

        # Compute normal night info for non-drunk players
        # (wrong_info poisoned player IS included here, will be overridden later)
        for pid, player in self.players.items():
            if pid == drunk_id or pid == poison_exclude:
                continue  # handled separately below

            group = dice_groups.get(player.dice, [])
            info = {
                "role": player.role,
                "dice": player.display_dice,  # show display_dice (may differ if swapped)
                "phase": "night",
            }

            if player.role == Role.THIEF:
                self._compute_thief_night_info(pid, player, group, info)
            else:
                self._compute_mouse_night_info(pid, player, group, thief_dice, info)

            # Outsider-specific info for this player
            if player.outsider == "ratatouille":
                info["outsider"] = "ratatouille"
                info["outsider_info"] = "🍳 你是料理鼠王！你的黑暗料理迷惑了一名玩家，但你不知道是谁。"
            elif player.outsider == "trickster":
                info["outsider"] = "trickster"
                info["outsider_info"] = "🧸 你是鼠小弟！你的捣蛋调换了两名玩家的骰子，但你不知道是谁。"
                info["can_peek"] = False  # trickster can never peek

            self.night_info[pid] = info

        # Apply poison effect
        if poison_pid:
            self._apply_poison_effect(dice_groups)

        # Handle drunk mouse: give them fake thief info
        if drunk_id:
            self._compute_drunk_night_info(drunk_id)

    def _compute_thief_night_info(self, pid: str, player, group: list, info: dict):
        """Compute night info for the real thief."""
        if self.thief_see_all_dice:
            info["all_dice"] = {p_id: p.display_dice for p_id, p in self.players.items()}
            info["message"] = "你是奶酪大盗！你已经偷走了奶酪🧀。你可以查看所有人的骰子点数。"
            info["same_group"] = []
        else:
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

    def _compute_mouse_night_info(self, pid: str, player, group: list, thief_dice: int, info: dict, perceived_dice: int = None):
        """Compute night info for a regular mouse (not drunk).
        perceived_dice: the dice value the player believes they have (for cheese_stolen check).
        Defaults to player.dice if not specified.
        """
        if perceived_dice is None:
            perceived_dice = player.dice
        same_group_ids = [g for g in group if g != pid]
        is_alone = len(same_group_ids) == 0
        thief_in_group = self.thief_id in group

        # Trickster cannot peek even if alone
        is_trickster = player.outsider == "trickster"

        if is_alone:
            if is_trickster:
                info["can_peek"] = False
                info["same_group"] = []
                info["message"] = "你独自睁眼。（🧸 作为鼠小弟，你不能偷看骰子）"
            else:
                info["can_peek"] = True
                info["same_group"] = []
                info["message"] = "你是瞌睡鼠，你独自睁眼。你可以偷看一位玩家的骰子点数。"
            if thief_dice < perceived_dice:
                info["cheese_stolen"] = True
                info["message"] += "\n⚠️ 你发现奶酪已经被偷走了！"
            else:
                info["message"] += "\n✅ 奶酪还在，没有被偷走。"
        else:
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
                info["thief_spotted"] = True
                thief_player = self.players[self.thief_id]
                info["spotted_thief_name"] = thief_player.name
                info["message"] = f"你是瞌睡鼠。你和其他玩家同时睁眼，你发现 {thief_player.name} 正在偷奶酪！🧀"
            else:
                names = "、".join(self.players[gid].name for gid in same_group_ids)
                info["message"] = f"你是瞌睡鼠。你和 {names} 同时睁眼了，你们互相确认都是好老鼠🐭。"
                if thief_dice < perceived_dice:
                    info["cheese_stolen"] = True
                    info["message"] += "\n⚠️ 你们发现奶酪已经被偷走了！"
                else:
                    info["message"] += "\n✅ 奶酪还在，没有被偷走。"

    def _apply_poison_effect(self, dice_groups: dict):
        """Apply poison effect based on poison_mode.

        wrong_time: Player wakes at fake dice time, sees real players there, correct operations.
        wrong_info: Player wakes at correct time, but sees fake group members or gets fake peek results.
        """
        pid = self.poison_target_id
        player = self.players[pid]
        fake_dice = self.poison_fake_dice
        thief_dice = self.players[self.thief_id].dice

        if self.poison_mode == "wrong_time":
            # Player is excluded from normal grouping, joins fake dice group
            fake_group = dice_groups.get(fake_dice, [])
            virtual_group = fake_group + [pid]

            info = {
                "role": player.role,
                "dice": player.display_dice,  # shows fake dice
                "phase": "night",
                "is_poisoned": True,
            }

            if player.role == Role.THIEF:
                self._compute_thief_night_info(pid, player, virtual_group, info)
            else:
                self._compute_mouse_night_info(pid, player, virtual_group, thief_dice, info, perceived_dice=fake_dice)

        elif self.poison_mode == "wrong_info":
            # Player is in their real group (already computed in main loop)
            # Override their night info with fake group's perspective
            fake_group = dice_groups.get(fake_dice, [])
            # Remove poisoned player from fake group if somehow present, then add them
            virtual_group = [p for p in fake_group if p != pid] + [pid]

            info = {
                "role": player.role,
                "dice": player.display_dice,  # shows real dice (unchanged)
                "phase": "night",
                "is_poisoned": True,
                "poison_wrong_info": True,  # flag for peek_dice to return fake result
            }

            if player.role == Role.THIEF:
                self._compute_thief_night_info(pid, player, virtual_group, info)
            else:
                # wrong_info: wake at correct time, so cheese_stolen uses real dice
                self._compute_mouse_night_info(pid, player, virtual_group, thief_dice, info, perceived_dice=player.dice)

        # If poisoned player is also an outsider, preserve their outsider info
        if player.outsider == "trickster":
            info["outsider"] = "trickster"
            info["outsider_info"] = "🧸 你是鼠小弟！你的捣蛋调换了两名玩家的骰子，但你不知道是谁。"
            info["can_peek"] = False  # trickster can never peek

        self.night_info[pid] = info

    def _compute_drunk_night_info(self, drunk_id: str):
        """Compute fake thief-like night info for the drunk mouse."""
        player = self.players[drunk_id]
        info = {
            "role": Role.THIEF,  # drunk mouse thinks they're the thief
            "dice": player.display_dice,
            "phase": "night",
            "outsider_actual": "drunk",  # hidden: actual outsider type
            "is_drunk": True,  # flag for frontend
        }
        if self.thief_see_all_dice:
            # Show fake randomized dice for all players
            fake_dice = {}
            for p_id, p in self.players.items():
                fake_dice[p_id] = random.randint(1, self.max_dice)
            fake_dice[drunk_id] = player.display_dice  # own dice is real
            info["all_dice"] = fake_dice
            info["message"] = "你是奶酪大盗！你已经偷走了奶酪🧀。你可以查看所有人的骰子点数。"
            info["same_group"] = []
        else:
            info["same_group"] = []
            info["message"] = "你是奶酪大盗！你已经偷走了奶酪🧀。你独自睁眼。"
        info["can_choose_accomplice"] = self.accomplice_enabled
        info["can_peek"] = False
        self.night_info[drunk_id] = info

    def get_player_night_info(self, player_id: str) -> dict:
        """Return night_info for a player, stripped of internal-only flags."""
        night = self.night_info.get(player_id, {})
        # Strip internal flags that should not be sent to the player
        internal_keys = {"is_poisoned", "outsider_actual"}
        return {k: v for k, v in night.items() if k not in internal_keys}

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
        # Thief must have chosen accomplice (raw choice)
        if self.must_choose_accomplice() and self.thief_raw_accomplice_id is None:
            return False
        # Drunk mouse must have chosen their "accomplice" (only if accomplice is enabled)
        if self.accomplice_enabled and self.outsider_type == "drunk" and self.outsider_id:
            if self.drunk_accomplice_id is None:
                return False
        # All mice that can peek must have peeked
        for pid, night in self.night_info.items():
            if night.get("can_peek") and not night.get("has_peeked"):
                return False
        return True

    def can_end_night(self, player_id: str) -> bool:
        """Check if a player can click 'end night'.
        Conditions:
        1. Player's own action is complete (mouse peeked if can_peek; thief chose accomplice; drunk chose accomplice)
        2. All players' actions must be complete (global wait condition)
        """
        player = self.players.get(player_id)
        if not player:
            return False

        # Per-player: own action must be done first
        if player.role == Role.THIEF and player.outsider != "drunk":
            # Real thief
            if self.must_choose_accomplice() and self.thief_raw_accomplice_id is None:
                return False
        elif player.outsider == "drunk":
            # Drunk mouse must choose their fake accomplice (only if accomplice enabled)
            if self.accomplice_enabled and self.drunk_accomplice_id is None:
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
        """Real thief chooses accomplice."""
        if thief_id != self.thief_id:
            return False
        if target_id == thief_id:
            return False
        if target_id not in self.players:
            return False

        self.thief_raw_accomplice_id = target_id

        # Check if thief chose the drunk mouse
        drunk_id = self.outsider_id if self.outsider_type == "drunk" else None
        if drunk_id and target_id == drunk_id:
            # Thief chose drunk mouse - don't make drunk mouse accomplice yet
            # Real accomplice will be resolved when drunk mouse also chooses
            # Update thief's night_info
            accomplice = self.players[target_id]
            if thief_id in self.night_info:
                self.night_info[thief_id]["accomplice_id"] = target_id
                self.night_info[thief_id]["accomplice_name"] = accomplice.name
                self.night_info[thief_id]["can_choose_accomplice"] = False
            # Try to resolve if drunk mouse already chose
            self._resolve_accomplice()
            return True

        # Normal case: target becomes accomplice directly
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
                "thief_dice": thief.display_dice,
                "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。",
            })
        # Update thief's night_info
        accomplice = self.players[target_id]
        if thief_id in self.night_info:
            self.night_info[thief_id]["accomplice_id"] = target_id
            self.night_info[thief_id]["accomplice_name"] = accomplice.name
            self.night_info[thief_id]["can_choose_accomplice"] = False

        return True

    def drunk_choose_accomplice(self, drunk_id: str, target_id: str) -> bool:
        """Drunk mouse chooses their fake accomplice."""
        if self.outsider_type != "drunk" or drunk_id != self.outsider_id:
            return False
        if target_id == drunk_id:
            return False
        if target_id not in self.players:
            return False
        # Note: drunk mouse CAN pick the real thief (they don't know who it is).
        # If they do, _resolve_accomplice will handle it gracefully.

        self.drunk_accomplice_id = target_id

        # Update drunk mouse's night_info
        accomplice = self.players[target_id]
        if drunk_id in self.night_info:
            self.night_info[drunk_id]["accomplice_id"] = target_id
            self.night_info[drunk_id]["accomplice_name"] = accomplice.name
            self.night_info[drunk_id]["can_choose_accomplice"] = False

        # Try to resolve if thief already chose drunk mouse
        self._resolve_accomplice()
        return True

    def _resolve_accomplice(self):
        """Resolve accomplice when both thief and drunk mouse have chosen.
        If thief chose drunk mouse, drunk mouse's pick becomes the real accomplice.
        """
        if self.accomplice_id is not None:
            return  # already resolved
        drunk_id = self.outsider_id if self.outsider_type == "drunk" else None
        if not drunk_id:
            return
        if self.thief_raw_accomplice_id != drunk_id:
            return  # thief didn't pick drunk mouse
        if self.drunk_accomplice_id is None:
            return  # drunk mouse hasn't chosen yet

        # Drunk mouse's pick becomes the real accomplice
        real_accomplice_id = self.drunk_accomplice_id
        # Edge case: drunk mouse picked the real thief - can't make thief their own accomplice
        if real_accomplice_id == self.thief_id:
            return  # no accomplice created, but both have made their choices

        self.accomplice_id = real_accomplice_id
        self.players[real_accomplice_id].is_accomplice = True
        self.players[real_accomplice_id].role = Role.ACCOMPLICE

        # The accomplice knows the real thief
        thief = self.players[self.thief_id]
        if real_accomplice_id in self.night_info:
            self.night_info[real_accomplice_id].update({
                "role": "accomplice",
                "is_accomplice": True,
                "thief_id": self.thief_id,
                "thief_name": thief.name,
                "thief_dice": thief.display_dice,
                "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。\n（你是被🍺酒鬼鼠间接选中的）",
            })

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
        # Determine peek result based on poison mode
        if night.get("poison_wrong_info"):
            # wrong_info mode: player wakes at correct time but gets fake peek result
            possible = [d for d in range(1, self.max_dice + 1) if d != target.display_dice]
            peek_result = random.choice(possible) if possible else target.display_dice
        else:
            # Normal or wrong_time mode: show real display_dice
            peek_result = target.display_dice

        player.has_peeked = True
        player.peek_target = target_id
        player.peek_result = peek_result
        self.night_actions_done.add(player_id)

        # Update night_info with peek result
        self.night_info[player_id]["has_peeked"] = True
        self.night_info[player_id]["peek_target"] = target_id
        self.night_info[player_id]["peek_target_name"] = target.name
        self.night_info[player_id]["peek_result"] = peek_result

        return peek_result

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
        # Group by actual dice value for ordering
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
                # Show outsider tag
                if player.outsider:
                    outsider_labels = {
                        "ratatouille": "🍳 料理鼠王",
                        "trickster": "🧸 鼠小弟",
                        "drunk": "🍺 酒鬼鼠",
                    }
                    entry["outsider"] = player.outsider
                    entry["outsider_label"] = outsider_labels.get(player.outsider, player.outsider)
                # Show display_dice if different from actual
                if player.display_dice != player.dice:
                    entry["display_dice"] = player.display_dice

                if player.role == Role.THIEF:
                    entry["actions"].append("🧀 偷走了奶酪")
                    if self.thief_raw_accomplice_id:
                        raw_acc = self.players[self.thief_raw_accomplice_id]
                        entry["actions"].append(f"🤝 选择了 {raw_acc.name} 作为共犯")
                        # Thief chose drunk mouse
                        if self.thief_raw_accomplice_id == self.outsider_id and self.outsider_type == "drunk":
                            if self.accomplice_id:
                                real_acc = self.players[self.accomplice_id]
                                entry["actions"].append(f"🍺 实际共犯被酒鬼鼠转移给了 {real_acc.name}")
                            elif self.drunk_accomplice_id == self.thief_id:
                                entry["actions"].append("🍺↔️ 酒鬼鼠也选了你→互选导致本局没有共犯！")
                elif player.outsider == "drunk":
                    entry["actions"].append("🍺 以为自己是大盗，全程闭眼睡觉")
                    if self.drunk_accomplice_id:
                        drunk_acc = self.players[self.drunk_accomplice_id]
                        entry["actions"].append(f"🤝 选择了 {drunk_acc.name} 作为“共犯”")
                        if self.thief_raw_accomplice_id == self.outsider_id:
                            # Drunk was picked by thief, check if mutual selection
                            if self.drunk_accomplice_id == self.thief_id:
                                entry["actions"].append("🍺↔️ 你选了真大盗→互选导致本局没有共犯！")
                            else:
                                entry["actions"].append("✅ 被真大盗选中，共犯选择生效！")
                        else:
                            entry["actions"].append("❌ 未被真大盗选中，共犯选择未生效")
                elif player.is_accomplice:
                    thief = self.players[self.thief_id]
                    if self.thief_raw_accomplice_id == self.outsider_id:
                        entry["actions"].append(f"🤝 被🍺酒鬼鼠间接选为共犯（真大盗: {thief.name}）")
                    else:
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

                # Outsider-specific action log entries
                if player.outsider == "ratatouille":
                    poison_target = self.players.get(self.poison_target_id)
                    if poison_target and self.poison_fake_dice:
                        if self.poison_mode == "wrong_time":
                            entry["actions"].append(f"🍳 黑暗料理迷惑了 {poison_target.name}，TA在{self.poison_fake_dice}点时醒来（实际{poison_target.dice}点）")
                        else:
                            entry["actions"].append(f"🍳 黑暗料理迷惑了 {poison_target.name}，TA看到了错误的信息（以为周围是{self.poison_fake_dice}点的玩家）")
                elif player.outsider == "trickster" and self.swap_info:
                    p1_name = self.players[self.swap_info['pid1']].name
                    p2_name = self.players[self.swap_info['pid2']].name
                    entry["actions"].append(f"🧸 调换了 {p1_name} 和 {p2_name} 的骰子")

                # Poison victim tag
                if pid == self.poison_target_id and self.outsider_type == "ratatouille" and self.poison_fake_dice:
                    if self.poison_mode == "wrong_time":
                        entry["actions"].append(f"☠️ 被黑暗料理迷惑，在{self.poison_fake_dice}点时醒来（实际{player.dice}点）")
                    else:
                        entry["actions"].append(f"☠️ 被黑暗料理迷惑，看到了错误的信息（以为周围是{self.poison_fake_dice}点的玩家）")

                # Swap victim tag
                if self.swap_info and pid in (self.swap_info['pid1'], self.swap_info['pid2']):
                    if player.outsider != "trickster":  # don't double-tag the trickster
                        entry["actions"].append(f"🧸 骰子被鼠小弟调换（以为{player.display_dice}点，实际{player.dice}点）")

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

        result = {
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
        # Include outsider info in result
        if self.outsider_type and self.outsider_id:
            outsider_player = self.players[self.outsider_id]
            result["outsider_type"] = self.outsider_type
            result["outsider_id"] = self.outsider_id
            result["outsider_name"] = outsider_player.name
        # Flag: mutual selection caused no accomplice
        if (self.outsider_type == "drunk"
                and self.thief_raw_accomplice_id == self.outsider_id
                and self.drunk_accomplice_id == self.thief_id
                and self.accomplice_id is None):
            result["no_accomplice_reason"] = "mutual_selection"
        return result

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
        # Reset outsider game state
        self.outsider_type = None
        self.outsider_id = None
        self.poison_target_id = None
        self.poison_fake_dice = None
        self.poison_mode = None
        self.swap_info = None
        self.drunk_accomplice_id = None
        self.thief_raw_accomplice_id = None
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
            "outsiders": self._outsider_settings_list(),
        }

        # Include personalized game info for all active game phases (Bug3: survives refresh)
        if for_player_id and self.phase != GamePhase.WAITING:
            player = self.players.get(for_player_id)
            if player:
                # Drunk mouse continues to see fake thief role through all phases
                display_role = player.role
                if player.outsider == "drunk":
                    display_role = Role.THIEF
                my_info = {
                    "role": display_role,
                    "dice": player.display_dice,
                    "is_accomplice": player.is_accomplice,
                }
                if player.outsider == "drunk":
                    my_info["is_drunk"] = True
                if self.phase == GamePhase.NIGHT:
                    night = self.get_player_night_info(for_player_id)
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
