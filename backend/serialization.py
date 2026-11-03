from models import Player, GamePhase


class SerializationMixin:
    """Mixin for room serialization, deserialization, and game reset."""

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
        self.thief_raw_accomplice_id = None
        self.dodobird_id = None
        self.dodobird_accomplice_id = None
        self.player_order = []
        # Move spectators into players (up to max_players)
        for sid, sp in list(self.spectators.items()):
            if len(self.players) < self.max_players:
                self.players[sid] = sp
                del self.spectators[sid]
        for p in self.players.values():
            p.reset_game_state()

    def serialize(self) -> dict:
        """Serialize full room state for Redis persistence."""
        return {
            "schema_version": 2,
            "id": self.id,
            "creator_id": self.creator_id,
            "phase": self.phase,
            "thief_id": self.thief_id,
            "accomplice_id": self.accomplice_id,
            "cheese_location": self.cheese_location,
            "min_players": self.min_players,
            "max_players": self.max_players,
            "accomplice_enabled": self.accomplice_enabled,
            "thief_see_all_dice": self.thief_see_all_dice,
            "max_dice": self.max_dice,
            "discussion_seconds": self.discussion_seconds,
            "night_actions_done": list(self.night_actions_done),
            "vote_results": self.vote_results,
            "voted_player_id": self.voted_player_id,
            "winner": self.winner,
            "night_info": self.night_info,
            "vote_requests": list(self.vote_requests),
            "player_order": self.player_order,
            "all_disconnected_since": self.all_disconnected_since,
            # Outsider settings
            "outsider_dodobird": self.outsider_dodobird,
            # Outsider game state
            "outsider_type": self.outsider_type,
            "outsider_id": self.outsider_id,
            "thief_raw_accomplice_id": self.thief_raw_accomplice_id,
            # Dodobird state
            "dodobird_id": self.dodobird_id,
            "dodobird_accomplice_id": self.dodobird_accomplice_id,
            # Players
            "players": {pid: p.serialize() for pid, p in self.players.items()},
            # Spectators
            "spectators": {sid: s.serialize() for sid, s in self.spectators.items()},
        }

    @classmethod
    def deserialize(cls, data: dict) -> "SerializationMixin":
        """Restore room from serialized data."""
        room = cls(data["id"], data["creator_id"])
        room.phase = data.get("phase", GamePhase.WAITING)
        room.thief_id = data.get("thief_id")
        room.accomplice_id = data.get("accomplice_id")
        room.cheese_location = data.get("cheese_location")
        room.min_players = data.get("min_players", 5)
        room.max_players = data.get("max_players", 8)
        room.accomplice_enabled = data.get("accomplice_enabled", True)
        room.thief_see_all_dice = data.get("thief_see_all_dice", True)
        room.max_dice = data.get("max_dice", 6)
        room.discussion_seconds = data.get("discussion_seconds", 180)
        room.night_actions_done = set(data.get("night_actions_done", []))
        room.vote_results = data.get("vote_results", {})
        room.voted_player_id = data.get("voted_player_id")
        room.winner = data.get("winner")
        room.night_info = data.get("night_info", {})
        room.vote_requests = set(data.get("vote_requests", []))
        room.player_order = data.get("player_order", [])
        room.all_disconnected_since = data.get("all_disconnected_since")
        # Outsider settings
        room.outsider_dodobird = data.get("outsider_dodobird", False)
        # Outsider game state
        room.outsider_type = data.get("outsider_type")
        room.outsider_id = data.get("outsider_id")
        room.thief_raw_accomplice_id = data.get("thief_raw_accomplice_id")
        # Dodobird state
        room.dodobird_id = data.get("dodobird_id")
        room.dodobird_accomplice_id = data.get("dodobird_accomplice_id")
        # Players
        for pid, pdata in data.get("players", {}).items():
            room.players[pid] = Player.deserialize(pdata)
        # Spectators
        for sid, sdata in data.get("spectators", {}).items():
            room.spectators[sid] = Player.deserialize(sdata)
        # Earlier snapshots can contain rules and roles that no longer exist.
        if data.get("schema_version") != 2 and room.phase != GamePhase.WAITING:
            room.reset_for_new_game()
        return room
