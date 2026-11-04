from models import GamePhase, Role


class RoomStateMixin:
    """Mixin for room state querying and display."""

    def _outsider_settings_list(self) -> list[str]:
        """Return list of enabled outsider type strings."""
        return ["dodobird"] if self.outsider_dodobird else []

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

    def get_room_state(self, for_player_id: str = None) -> dict:
        is_spectator = for_player_id and for_player_id in self.spectators
        players_data = {}
        for pid, p in self.players.items():
            is_self = (pid == for_player_id)
            reveal = (self.phase == GamePhase.RESULT)
            players_data[pid] = p.to_dict(reveal=reveal, is_self=is_self)
            if is_self and not reveal and p.is_accomplice and self.dodobird_id and not self.dodobird_accomplice_id:
                players_data[pid]["role"] = Role.MOUSE
                players_data[pid]["is_accomplice"] = False
            if (is_self and not reveal and self.thief_raw_accomplice_id
                    and pid == self.dodobird_accomplice_id and not p.is_accomplice):
                players_data[pid]["role"] = Role.ACCOMPLICE
                players_data[pid]["is_accomplice"] = True

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
            "spectators": spectators_data,
        }

        if is_spectator:
            data["is_spectator"] = True
            if self.phase == GamePhase.RESULT:
                data["vote_results"] = self.vote_results
                data["voted_player_id"] = self.voted_player_id
                data["winner"] = self.winner
                data["thief_id"] = self.thief_id
                data["accomplice_id"] = self.accomplice_id
                data["action_log"] = self.build_action_log()
                data["dodobird_id"] = self.dodobird_id
            return data

        # Include personalized game info for all active game phases (Bug3: survives refresh)
        if for_player_id and self.phase != GamePhase.WAITING:
            player = self.players.get(for_player_id)
            if player:
                pending = bool(self.dodobird_id and not self.dodobird_accomplice_id)
                my_info = {"role": Role.MOUSE if pending and player.is_accomplice else player.role,
                           "dice": player.display_dice,
                           "is_accomplice": player.is_accomplice and not pending}
                if player.role == Role.DODOBIRD:
                    my_info["is_dodobird"] = True
                # Always include night_info so refresh in any phase preserves game info
                night = self.get_player_night_info(for_player_id)
                my_info.update(night)
                if player.is_accomplice and not pending:
                    thief = self.players[self.thief_id]
                    my_info.update({"role": Role.ACCOMPLICE, "is_accomplice": True,
                                    "thief_id": self.thief_id, "thief_name": thief.name,
                                    "thief_dice": thief.dice,
                                    "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。"})
                if self.phase == GamePhase.NIGHT:
                    my_info["can_end_night"] = self.can_end_night(for_player_id)
                    my_info["i_night_done"] = for_player_id in self.night_actions_done
                # Fake accomplice (chosen by dodobird) thinks they're accomplice
                # Only show after BOTH thief and dodobird have chosen (deferred timing)
                is_fake_acc = (self.dodobird_accomplice_id
                               and for_player_id == self.dodobird_accomplice_id
                               and not player.is_accomplice
                               and self.thief_raw_accomplice_id is not None)
                if is_fake_acc:
                    my_info["role"] = Role.ACCOMPLICE  # they think they are accomplice
                    my_info["is_accomplice"] = True  # they think they are
                    # Show dodobird as "thief" so fake accomplice sees dodobird's info
                    dodobird = self.players[self.dodobird_id]
                    my_info["thief_id"] = self.dodobird_id
                    my_info["thief_name"] = dodobird.name
                    my_info["thief_dice"] = dodobird.dice
                    my_info["message"] = f"奶酪大盗 {dodobird.name} 选择你作为共犯！你们同赢同输。"
                data["my_info"] = my_info

        if self.phase == GamePhase.NIGHT:
            data["night_done_count"] = len(self.night_actions_done)
            data["night_total"] = len(self.players)

        if self.phase == GamePhase.DAY:
            data["vote_request_count"] = self.vote_request_count()
            data["vote_request_required"] = self.vote_request_required()
            if for_player_id:
                data["i_requested_vote"] = for_player_id in self.vote_requests
        if self.phase == GamePhase.VOTING:
            voted_count = sum(1 for p in self.players.values() if p.voted_for is not None)
            data["voted_count"] = voted_count
            data["total_voters"] = len(self.players)
        if self.phase == GamePhase.VOTING:
            # Accomplice (real or fake) needs to know thief_id to disable voting
            if for_player_id:
                p = self.players.get(for_player_id)
                is_fake_acc = (self.dodobird_accomplice_id
                               and for_player_id == self.dodobird_accomplice_id
                               and not p.is_accomplice)
                if p and p.is_accomplice:
                    data["no_vote_target"] = self.thief_id
                elif p and is_fake_acc:
                    data["no_vote_target"] = self.dodobird_id
                # Dodobird and thief can only vote for each other
                if self.dodobird_id:
                    if for_player_id == self.dodobird_id:
                        data["vote_only_target"] = self.thief_id
                    elif for_player_id == self.thief_id:
                        data["vote_only_target"] = self.dodobird_id

        if self.phase == GamePhase.RESULT:
            data["vote_results"] = self.vote_results
            data["voted_player_id"] = self.voted_player_id
            data["winner"] = self.winner
            data["thief_id"] = self.thief_id
            data["accomplice_id"] = self.accomplice_id
            data["action_log"] = self.build_action_log()
            if self.dodobird_id:
                data["dodobird_id"] = self.dodobird_id

        return data
