from models import GamePhase, Role
from typing import Optional


class VotingMixin:
    """Mixin for day phase and voting logic."""

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
        # Real accomplice cannot vote for real thief
        is_fake_acc = (self.dodobird_accomplice_id
                       and voter_id == self.dodobird_accomplice_id
                       and not voter.is_accomplice)
        if voter.is_accomplice and target_id == self.thief_id:
            return False, "作为共犯，你不能给奶酪大盗投票"
        # Fake accomplice cannot vote for dodobird (who they think is the thief)
        if is_fake_acc and target_id == self.dodobird_id:
            return False, "作为共犯，你不能给奶酪大盗投票"
        # Dodobird and thief can only vote for each other
        if self.dodobird_id:
            if voter_id == self.dodobird_id and target_id != self.thief_id:
                return False, "呆呆鸟只能投票给奶酪大盗"
            if voter_id == self.thief_id and target_id != self.dodobird_id:
                return False, "奶酪大盗只能投票给呆呆鸟"
        voter.voted_for = target_id
        return True, ""

    def all_voted(self) -> bool:
        for p in self.players.values():
            if p.voted_for is None:
                return False
        return True

    def tally_votes(self) -> dict:
        tally: dict[str, int] = {}
        for p in self.players.values():
            if p.voted_for:
                tally[p.voted_for] = tally.get(p.voted_for, 0) + 1

        self.vote_results = tally

        # Determine dodobird win separately
        dodobird_win = False
        enter_assassinate = False

        if not tally:
            self.voted_player_id = None
            self.winner = "thief"
        else:
            max_votes = max(tally.values())
            top = [pid for pid, v in tally.items() if v == max_votes]
            self.voted_player_id = top[0]  # tie: first one

            # Check if dodobird was voted out
            if self.dodobird_id and self.voted_player_id == self.dodobird_id:
                dodobird_win = True
                self.winner = "thief"
            elif self.voted_player_id == self.thief_id:
                # Mice found the thief! But if Tom is active and hasn't used assassination...
                if self.tom_id and not self.assassinate_used:
                    enter_assassinate = True
                    # Don't set winner yet - wait for assassination phase
                else:
                    self.winner = "mouse"
            else:
                self.winner = "thief"

        if enter_assassinate:
            self.phase = GamePhase.ASSASSINATE
        else:
            self.phase = GamePhase.RESULT

        result = {
            "vote_results": tally,
            "voted_player_id": self.voted_player_id,
            "voted_player_name": self.players[self.voted_player_id].name if self.voted_player_id else None,
            "voted_player_is_thief": self.voted_player_id == self.thief_id,
            "thief_id": self.thief_id,
            "thief_name": self.players[self.thief_id].name,
            "accomplice_id": self.accomplice_id,
            "accomplice_name": self.players[self.accomplice_id].name if self.accomplice_id else None,
        }

        if enter_assassinate:
            result["phase"] = "assassinate"
            result["tom_id"] = self.tom_id
            result["tom_name"] = self.players[self.tom_id].name
            result["assassinate_seconds"] = 30
            return result

        # Normal result phase
        action_log = self.build_action_log()
        result.update({
            "winner": self.winner,
            "players": {pid: p.to_dict(reveal=True) for pid, p in self.players.items()},
            "action_log": action_log,
        })
        # Include outsider info in result
        if self.outsider_type and self.outsider_id:
            outsider_player = self.players[self.outsider_id]
            result["outsider_type"] = self.outsider_type
            result["outsider_id"] = self.outsider_id
            result["outsider_name"] = outsider_player.name
        # Include Tom & Jerry info
        if self.tom_id:
            result["tom_id"] = self.tom_id
            result["tom_name"] = self.players[self.tom_id].name
        if self.jerry_id:
            result["jerry_id"] = self.jerry_id
            result["jerry_name"] = self.players[self.jerry_id].name
        if self.assassinate_result:
            result["assassinate_result"] = self.assassinate_result
            result["assassinate_target_id"] = self.assassinate_target_id
        # Include dodobird info in result
        if self.dodobird_id:
            dodobird_player = self.players[self.dodobird_id]
            result["dodobird_id"] = self.dodobird_id
            result["dodobird_name"] = dodobird_player.name
            result["dodobird_win"] = dodobird_win
            if self.dodobird_accomplice_id:
                fake_acc = self.players[self.dodobird_accomplice_id]
                result["dodobird_accomplice_id"] = self.dodobird_accomplice_id
                result["dodobird_accomplice_name"] = fake_acc.name
                result["dodobird_accomplice_is_real"] = (self.dodobird_accomplice_id == self.accomplice_id)
        # Include hex skill info
        if self.hex_type and self.hex_target_id:
            result["hex_type"] = self.hex_type
            result["hex_target_id"] = self.hex_target_id
            result["hex_target_name"] = self.players[self.hex_target_id].name
        # Flag: mutual selection caused no accomplice
        if (self.outsider_type == "drunk"
                and self.thief_raw_accomplice_id == self.outsider_id
                and self.drunk_accomplice_id == self.thief_id
                and self.accomplice_id is None):
            result["no_accomplice_reason"] = "mutual_selection"
        return result

    def finalize_assassinate(self, assassinate_result: Optional[dict] = None) -> dict:
        """Finalize the ASSASSINATE phase and move to RESULT.
        Called after Tom assassinates or after timeout.
        """
        if assassinate_result and assassinate_result.get("correct"):
            self.winner = "thief"
        else:
            # Tom failed or timed out -> mice win
            if not self.assassinate_used:
                # Timeout: mark as used with no target
                self.assassinate_used = True
                self.assassinate_result = "timeout"
            self.winner = "mouse"

        self.phase = GamePhase.RESULT
        action_log = self.build_action_log()

        result = {
            "vote_results": self.vote_results,
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
            "tom_id": self.tom_id,
            "tom_name": self.players[self.tom_id].name if self.tom_id else None,
            "jerry_id": self.jerry_id,
            "jerry_name": self.players[self.jerry_id].name if self.jerry_id else None,
            "assassinate_result": self.assassinate_result,
            "assassinate_target_id": self.assassinate_target_id,
        }
        if self.hex_type and self.hex_target_id:
            result["hex_type"] = self.hex_type
            result["hex_target_id"] = self.hex_target_id
            result["hex_target_name"] = self.players[self.hex_target_id].name
        return result
