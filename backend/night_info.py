import random
from models import Role


class NightInfoMixin:
    def _assign_outsider(self):
        if self.outsider_dodobird:
            candidates = [pid for pid in self.players if pid != self.thief_id]
            if candidates:
                self.dodobird_id = random.choice(candidates)
                self.outsider_id = self.dodobird_id
                self.outsider_type = "dodobird"
                self.players[self.dodobird_id].role = Role.DODOBIRD
                self.players[self.dodobird_id].outsider = "dodobird"

    def compute_night_info(self):
        groups = {}
        for pid, player in self.players.items():
            groups.setdefault(player.dice, []).append(pid)
        thief_dice = self.players[self.thief_id].dice
        for pid, player in self.players.items():
            info = {"role": player.role, "dice": player.dice, "phase": "night"}
            group = groups[player.dice]
            if player.role == Role.THIEF:
                self._compute_thief_night_info(pid, player, group, info)
            elif player.role == Role.DODOBIRD:
                self._compute_dodobird_night_info(pid, player, group, thief_dice, info)
            else:
                self._compute_mouse_night_info(pid, player, group, thief_dice, info)
            self.night_info[pid] = info

    def _compute_thief_night_info(self, pid: str, player, group: list, info: dict):
        """Compute night info for the real thief."""
        if self.thief_see_all_dice:
            info["all_dice"] = {p_id: p.dice for p_id, p in self.players.items()}
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

        # Thief knows who dodobird is (if in play)
        if self.dodobird_id:
            dodobird_player = self.players[self.dodobird_id]
            info["dodobird_id"] = self.dodobird_id
            info["dodobird_name"] = dodobird_player.name
            info["message"] += f"\n🐦 呆呆鸟是 {dodobird_player.name}（不能选TA为共犯）"

    def _compute_mouse_night_info(self, pid: str, player, group: list, thief_dice: int, info: dict, perceived_dice: int = None):
        """Compute night info for a regular mouse.
        perceived_dice: the dice value the player believes they have (for cheese_stolen check).
        Defaults to player.dice if not specified.
        """
        if perceived_dice is None:
            perceived_dice = player.dice
        same_group_ids = [g for g in group if g != pid]
        is_alone = len(same_group_ids) == 0
        thief_in_group = self.thief_id in group

        if is_alone:
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
                info["message"] = f"你是瞌睡鼠。你和 {names} 同时睁眼了，没看到有人偷奶酪。"
                if thief_dice < perceived_dice:
                    info["cheese_stolen"] = True
                    info["message"] += "\n⚠️ 你们发现奶酪已经被偷走了！"
                else:
                    info["message"] += "\n✅ 奶酪还在，没有被偷走。"

    def _compute_dodobird_night_info(self, pid: str, player, group: list, thief_dice: int, info: dict, perceived_dice: int = None):
        """Compute night info for the dodobird (outsider role).
        Dodobird behaves like a mouse during night but knows the thief and can choose fake accomplice.
        """
        if perceived_dice is None:
            perceived_dice = player.dice
        same_group_ids = [g for g in group if g != pid]
        is_alone = len(same_group_ids) == 0
        thief_in_group = self.thief_id in group

        info["is_dodobird"] = True
        info["outsider"] = "dodobird"

        # Dodobird knows who the thief is
        thief_player = self.players[self.thief_id]
        info["thief_id"] = self.thief_id
        info["thief_name"] = thief_player.name
        # Dodobird always sees all dice (regardless of thief_see_all_dice setting)
        info["all_dice"] = {p_id: p.dice for p_id, p in self.players.items()}

        # Dodobird can choose fake accomplice (if accomplice enabled)
        if self.must_choose_accomplice():
            info["can_choose_accomplice"] = True

        if is_alone:
            info["can_peek"] = True
            info["same_group"] = []
            info["message"] = f"你是呆呆鸟🐦（外来者）。你独自睁眼。你可以偷看一位玩家的骰子点数。"
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
                info["spotted_thief_name"] = thief_player.name
                info["message"] = f"你是呆呆鸟🐦（外来者）。你和其他玩家同时睁眼，你发现 {thief_player.name} 正在偷奶酪！🧀"
            else:
                names = "、".join(self.players[gid].name for gid in same_group_ids)
                info["message"] = f"你是呆呆鸟🐦（外来者）。你和 {names} 同时睁眼了。"
                if thief_dice < perceived_dice:
                    info["cheese_stolen"] = True
                    info["message"] += "\n⚠️ 你们发现奶酪已经被偷走了！"
                else:
                    info["message"] += "\n✅ 奶酪还在，没有被偷走。"

        info["message"] += f"\n🔍 你知道奶酪大盗是 {thief_player.name}！"
        if self.must_choose_accomplice():
            info["message"] += "\n🤝 你需要选择一名假共犯（不能选大盗），被选中的人会以为是大盗选了TA。"
        info["message"] += "\n🎯 你的目标：让自己被投票出局即可获胜！"

    def get_player_night_info(self, player_id: str) -> dict:
        return dict(self.night_info.get(player_id, {}))
