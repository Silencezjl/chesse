import random
from typing import Optional
from models import Role


class NightActionsMixin:
    """Mixin for night phase actions: accomplice selection, peeking, night completion."""

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
        # Dodobird must have chosen fake accomplice (if accomplice enabled)
        if self.must_choose_accomplice() and self.dodobird_id:
            if self.dodobird_accomplice_id is None:
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
        elif player.role == Role.DODOBIRD:
            # Dodobird must choose fake accomplice (if accomplice enabled)
            if self.must_choose_accomplice() and self.dodobird_accomplice_id is None:
                return False
            # Dodobird also needs to peek if can_peek
            night = self.night_info.get(player_id, {})
            if night.get("can_peek") and not night.get("has_peeked"):
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
        # Dodobird cannot be chosen as accomplice
        if target_id == self.dodobird_id:
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

        # Tom & Jerry assignment: accomplice becomes Tom, random mouse becomes Jerry
        if self.outsider_type == "tom_jerry":
            self._assign_tom_jerry_roles(target_id)

        # Finalize delayed hex skill now that accomplice is known
        self._finalize_delayed_hex_skill()

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

    def dodobird_choose_accomplice(self, dodobird_id: str, target_id: str) -> bool:
        """Dodobird chooses a fake accomplice. The target will think the real thief chose them."""
        if dodobird_id != self.dodobird_id:
            return False
        if target_id == dodobird_id:
            return False
        if target_id not in self.players:
            return False
        # Cannot choose the real thief
        if target_id == self.thief_id:
            return False

        self.dodobird_accomplice_id = target_id

        # Update dodobird's night_info
        target = self.players[target_id]
        if dodobird_id in self.night_info:
            self.night_info[dodobird_id]["accomplice_id"] = target_id
            self.night_info[dodobird_id]["accomplice_name"] = target.name
            self.night_info[dodobird_id]["can_choose_accomplice"] = False

        # Send fake accomplice info to target (showing real thief's identity)
        # This is handled in main.py handler
        # Check if target is also thief's real pick (overlap → real accomplice)
        # This is resolved naturally: if thief already set target as real accomplice,
        # the fake accomplice notification is redundant but harmless.

        return True

    def _assign_tom_jerry_roles(self, accomplice_id: str):
        """Assign Tom (assassin) to the accomplice and Jerry (merlin) to a random mouse."""
        # Accomplice becomes Tom
        self.tom_id = accomplice_id
        self.players[accomplice_id].outsider = "tom"

        # Update Tom's night_info
        if accomplice_id in self.night_info:
            self.night_info[accomplice_id]["is_tom"] = True
            self.night_info[accomplice_id]["outsider"] = "tom"
            self.night_info[accomplice_id]["message"] += (
                "\n\n🐱 你同时是 Tom（刺客）！你可以在任意时刻刺杀一名玩家。"
                "\n如果成功刺杀 Jerry，大盗阵营直接获胜！"
            )

        # Pick a random mouse as Jerry (not thief, not Tom, not dodobird)
        exclude = {self.thief_id, accomplice_id}
        if self.dodobird_id:
            exclude.add(self.dodobird_id)
        candidates = [pid for pid in self.players if pid not in exclude
                      and self.players[pid].role == Role.MOUSE]
        if not candidates:
            # Fallback: no valid Jerry candidate (shouldn't happen with 5+ players)
            return

        jerry_id = random.choice(candidates)
        self.jerry_id = jerry_id
        self.players[jerry_id].outsider = "jerry"
        self.players[jerry_id].role = Role.JERRY

        # Update Jerry's night_info with all dice + thief knowledge
        self._compute_jerry_night_info(jerry_id)

    def tom_assassinate(self, tom_id: str, target_id: str) -> dict:
        """Tom attempts to assassinate a player (guess Jerry).
        Can be used in any phase. Returns result dict.
        """
        if tom_id != self.tom_id:
            return {"success": False, "error": "你不是Tom"}
        if self.assassinate_used:
            return {"success": False, "error": "刺杀技能已经使用过"}
        if target_id not in self.players or target_id == tom_id:
            return {"success": False, "error": "无效的刺杀目标"}
        if target_id == self.thief_id:
            return {"success": False, "error": "不能刺杀大盗"}

        self.assassinate_target_id = target_id
        self.assassinate_used = True

        if target_id == self.jerry_id:
            self.assassinate_result = "success"
            self.winner = "thief"
            return {"success": True, "correct": True, "jerry_id": self.jerry_id}
        else:
            self.assassinate_result = "fail"
            return {"success": True, "correct": False, "jerry_id": self.jerry_id}

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
            # No accomplice created, but both have made their choices
            self._finalize_delayed_hex_skill()
            return

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

        # Finalize delayed hex skill now that accomplice is resolved
        self._finalize_delayed_hex_skill()

    def peek_dice(self, player_id: str, target_id: str) -> Optional[int]:
        player = self.players.get(player_id)
        if not player:
            return None
        if player.role == Role.THIEF:
            return None
        # Check can_peek from night_info (dice group rule)
        night = self.night_info.get(player_id, {})
        if not night.get("can_peek") and player.role != Role.JERRY:
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
