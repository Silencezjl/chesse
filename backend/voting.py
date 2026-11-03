from models import GamePhase, Role


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
        if voter_id == target_id:
            return False, "不能投票给自己"
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
        return all(p.voted_for is not None for p in self.players.values())

    def tally_votes(self) -> dict:
        tally = {}
        for player in self.players.values():
            if player.voted_for:
                tally[player.voted_for] = tally.get(player.voted_for, 0) + 1
        self.vote_results = tally

        self.voted_player_id = max(tally, key=tally.get) if tally else None
        dodobird_win = bool(self.dodobird_id and self.voted_player_id == self.dodobird_id)
        self.winner = "dodobird" if dodobird_win else "mouse" if self.voted_player_id == self.thief_id else "thief"
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
        return result
