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
        Only checks the player's own action is complete. No global wait —
        avoids leaking action order information.
        """
        player = self.players.get(player_id)
        if not player:
            return False

        # Per-player: own action must be done first
        if player.role == Role.THIEF:
            # Real thief
            if self.must_choose_accomplice() and self.thief_raw_accomplice_id is None:
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

        return True

    def choose_accomplice(self, thief_id: str, target_id: str) -> bool:
        """Real thief chooses accomplice."""
        if (not self.accomplice_enabled or thief_id != self.thief_id
                or self.thief_raw_accomplice_id is not None):
            return False
        if target_id == thief_id:
            return False
        if target_id not in self.players:
            return False
        # Dodobird cannot be chosen as accomplice
        if target_id == self.dodobird_id:
            return False

        self.thief_raw_accomplice_id = target_id

        # Normal case: target becomes accomplice directly
        self.accomplice_id = target_id
        self.players[target_id].is_accomplice = True
        self.players[target_id].role = Role.ACCOMPLICE

        # Update thief's night_info
        accomplice = self.players[target_id]
        if thief_id in self.night_info:
            self.night_info[thief_id]["accomplice_id"] = target_id
            self.night_info[thief_id]["accomplice_name"] = accomplice.name
            self.night_info[thief_id]["can_choose_accomplice"] = False

        return True

    def dodobird_choose_accomplice(self, dodobird_id: str, target_id: str) -> bool:
        """Dodobird chooses a fake accomplice. The target will think the real thief chose them."""
        if (not self.accomplice_enabled or dodobird_id != self.dodobird_id
                or self.dodobird_accomplice_id is not None):
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
        peek_result = target.dice
        player.has_peeked = True
        player.peek_target = target_id
        player.peek_result = peek_result

        # Update night_info with peek result
        self.night_info[player_id]["has_peeked"] = True
        self.night_info[player_id]["peek_target"] = target_id
        self.night_info[player_id]["peek_target_name"] = target.name
        self.night_info[player_id]["peek_result"] = peek_result

        return peek_result

    def mark_night_done(self, player_id: str):
        self.night_actions_done.add(player_id)

    def all_night_actions_done(self) -> bool:
        for pid in self.players:
            if pid not in self.night_actions_done:
                return False
        return True
