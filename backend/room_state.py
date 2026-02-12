from models import GamePhase, Role


class RoomStateMixin:
    """Mixin for room state querying and display."""

    def _outsider_settings_list(self) -> list[str]:
        """Return list of enabled outsider type strings."""
        result = []
        if self.outsider_drunk:
            result.append("drunk")
        if self.outsider_dodobird:
            result.append("dodobird")
        if self.outsider_tom_jerry:
            result.append("tom_jerry")
        return result

    def _hex_settings_list(self) -> list[str]:
        """Return list of enabled hex skill type strings."""
        result = []
        if self.hex_time_warp:
            result.append("time_warp")
        if self.hex_perception_interference:
            result.append("perception_interference")
        return result

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
            "hex_skills": self._hex_settings_list(),
        }

    def get_room_state(self, for_player_id: str = None) -> dict:
        is_spectator = for_player_id and for_player_id in self.spectators
        players_data = {}
        for pid, p in self.players.items():
            is_self = (pid == for_player_id)
            reveal = (self.phase == GamePhase.RESULT) or is_spectator
            players_data[pid] = p.to_dict(reveal=reveal, is_self=is_self)

        # Spectator list for display
        spectators_data = {}
        for sid, sp in self.spectators.items():
            spectators_data[sid] = {"id": sid, "name": sp.name, "avatar": sp.avatar, "connected": sp.connected}

        data = {
            "room_id": self.id,
            "phase": self.phase,
            "player_count": len(self.players),
            "min_players": self.min_players,
            "max_players": self.max_players,
            "players": players_data,
            "player_order": self.player_order if self.player_order else list(self.players.keys()),
            "creator_id": self.creator_id,
            "thief_see_all_dice": self.thief_see_all_dice,
            "max_dice": self.max_dice,
            "outsiders": self._outsider_settings_list(),
            "hex_skills": self._hex_settings_list(),
            "spectators": spectators_data,
        }

        if is_spectator:
            data["is_spectator"] = True
            # Spectators see result-like info during active game
            if self.phase in (GamePhase.NIGHT, GamePhase.DAY, GamePhase.VOTING):
                data["vote_results"] = self.vote_results
                data["thief_id"] = self.thief_id
                data["accomplice_id"] = self.accomplice_id
            if self.phase == GamePhase.RESULT:
                data["vote_results"] = self.vote_results
                data["voted_player_id"] = self.voted_player_id
                data["winner"] = self.winner
                data["thief_id"] = self.thief_id
                data["accomplice_id"] = self.accomplice_id
                data["action_log"] = self.build_action_log()
            return data

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
                if player.role == Role.DODOBIRD:
                    my_info["is_dodobird"] = True
                if player.role == Role.JERRY:
                    my_info["is_jerry"] = True
                if player.outsider == "tom":
                    my_info["is_tom"] = True
                    my_info["can_assassinate"] = not self.assassinate_used
                    if self.jerry_id:  # Tom doesn't know who Jerry is
                        pass  # intentionally don't reveal jerry_id
                # Fake accomplice (chosen by dodobird) thinks they're accomplice
                is_fake_acc = (self.dodobird_accomplice_id
                               and for_player_id == self.dodobird_accomplice_id
                               and not player.is_accomplice)
                if is_fake_acc:
                    my_info["role"] = Role.ACCOMPLICE  # they think they are accomplice
                    my_info["is_accomplice"] = True  # they think they are
                    my_info["is_fake_accomplice"] = True  # for result reveal
                    # Show thief info so fake accomplice sees it after refresh
                    thief = self.players[self.thief_id]
                    my_info["thief_id"] = self.thief_id
                    my_info["thief_name"] = thief.name
                    my_info["thief_dice"] = thief.dice
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
            # Accomplice (real or fake) needs to know thief_id to disable voting
            if for_player_id:
                p = self.players.get(for_player_id)
                is_fake_acc = (self.dodobird_accomplice_id
                               and for_player_id == self.dodobird_accomplice_id
                               and not p.is_accomplice)
                if p and (p.is_accomplice or is_fake_acc):
                    data["no_vote_target"] = self.thief_id

        if self.phase == GamePhase.ASSASSINATE:
            data["tom_id"] = self.tom_id
            data["assassinate_seconds"] = 30
            data["voted_player_id"] = self.voted_player_id
            data["voted_player_is_thief"] = self.voted_player_id == self.thief_id
            if for_player_id:
                p = self.players.get(for_player_id)
                if p and p.outsider == "tom":
                    data["is_tom"] = True
                    data["can_assassinate"] = not self.assassinate_used

        if self.phase == GamePhase.RESULT:
            data["vote_results"] = self.vote_results
            data["voted_player_id"] = self.voted_player_id
            data["winner"] = self.winner
            data["thief_id"] = self.thief_id
            data["accomplice_id"] = self.accomplice_id
            data["action_log"] = self.build_action_log()
            if self.dodobird_id:
                data["dodobird_id"] = self.dodobird_id
            if self.tom_id:
                data["tom_id"] = self.tom_id
            if self.jerry_id:
                data["jerry_id"] = self.jerry_id
            if self.assassinate_result:
                data["assassinate_result"] = self.assassinate_result
                data["assassinate_target_id"] = self.assassinate_target_id

        return data
