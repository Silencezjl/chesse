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
        self.player_order = []
        # Move spectators into players (up to max_players)
        for sid, sp in list(self.spectators.items()):
            if len(self.players) < self.max_players:
                self.players[sid] = sp
                del self.spectators[sid]
        self.spectators.clear()
        for p in self.players.values():
            p.reset_game_state()

    def serialize(self) -> dict:
        """Serialize full room state for Redis persistence."""
        return {
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
            "outsider_drunk": self.outsider_drunk,
            "outsider_dodobird": self.outsider_dodobird,
            "outsider_tom_jerry": self.outsider_tom_jerry,
            # Hex skill settings
            "hex_time_warp": self.hex_time_warp,
            "hex_perception_interference": self.hex_perception_interference,
            "hex_retirement_account": self.hex_retirement_account,
            "hex_lethal_tempo": self.hex_lethal_tempo,
            "hex_handpicked": self.hex_handpicked,
            # Outsider game state
            "outsider_type": self.outsider_type,
            "outsider_id": self.outsider_id,
            # Hex skill game state
            "hex_type": self.hex_type,
            "hex_target_id": self.hex_target_id,
            "poison_target_id": self.poison_target_id,
            "poison_fake_dice": self.poison_fake_dice,
            "poison_mode": self.poison_mode,
            "swap_info": self.swap_info,
            "day_start_time": self.day_start_time,
            "handpicked_boost_target_id": self.handpicked_boost_target_id,
            "hex_delayed": self.hex_delayed,
            "drunk_accomplice_id": self.drunk_accomplice_id,
            "thief_raw_accomplice_id": self.thief_raw_accomplice_id,
            # Dodobird state
            "dodobird_id": self.dodobird_id,
            "dodobird_accomplice_id": self.dodobird_accomplice_id,
            # Tom & Jerry state
            "tom_id": self.tom_id,
            "jerry_id": self.jerry_id,
            "assassinate_target_id": self.assassinate_target_id,
            "assassinate_used": self.assassinate_used,
            "assassinate_result": self.assassinate_result,
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
        room.outsider_drunk = data.get("outsider_drunk", False)
        room.outsider_dodobird = data.get("outsider_dodobird", False)
        room.outsider_tom_jerry = data.get("outsider_tom_jerry", False)
        # Hex skill settings
        room.hex_time_warp = data.get("hex_time_warp", False)
        room.hex_perception_interference = data.get("hex_perception_interference", False)
        room.hex_retirement_account = data.get("hex_retirement_account", False)
        room.hex_lethal_tempo = data.get("hex_lethal_tempo", False)
        room.hex_handpicked = data.get("hex_handpicked", False)
        # Outsider game state
        room.outsider_type = data.get("outsider_type")
        room.outsider_id = data.get("outsider_id")
        # Hex skill game state
        room.hex_type = data.get("hex_type")
        room.hex_target_id = data.get("hex_target_id")
        room.poison_target_id = data.get("poison_target_id")
        room.poison_fake_dice = data.get("poison_fake_dice")
        room.poison_mode = data.get("poison_mode")
        room.swap_info = data.get("swap_info")
        room.day_start_time = data.get("day_start_time")
        room.handpicked_boost_target_id = data.get("handpicked_boost_target_id")
        room.hex_delayed = data.get("hex_delayed", False)
        room.drunk_accomplice_id = data.get("drunk_accomplice_id")
        room.thief_raw_accomplice_id = data.get("thief_raw_accomplice_id")
        # Dodobird state
        room.dodobird_id = data.get("dodobird_id")
        room.dodobird_accomplice_id = data.get("dodobird_accomplice_id")
        # Tom & Jerry state
        room.tom_id = data.get("tom_id")
        room.jerry_id = data.get("jerry_id")
        room.assassinate_target_id = data.get("assassinate_target_id")
        room.assassinate_used = data.get("assassinate_used", False)
        room.assassinate_result = data.get("assassinate_result")
        # Players
        for pid, pdata in data.get("players", {}).items():
            room.players[pid] = Player.deserialize(pdata)
        # Spectators
        for sid, sdata in data.get("spectators", {}).items():
            room.spectators[sid] = Player.deserialize(sdata)
        return room
