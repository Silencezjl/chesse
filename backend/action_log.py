from models import Role


class ActionLogMixin:
    """Mixin for building the chronological action log."""

    def build_action_log(self) -> list[dict]:
        """Build a chronological summary of all players' night actions."""
        log = []
        # Build wake_dice map (same logic as compute_night_info)
        wake_dice: dict[str, int] = {}
        for pid, player in self.players.items():
            wake_dice[pid] = player.dice
        if self.swap_info and self.hex_type == "time_warp":
            pid1, pid2 = self.swap_info["pid1"], self.swap_info["pid2"]
            wake_dice[pid1] = self.swap_info["dice2"]
            wake_dice[pid2] = self.swap_info["dice1"]
        # Group by wake_dice value for ordering (reflects actual wake-up order)
        dice_groups: dict[int, list[str]] = {}
        for pid, player in self.players.items():
            dice_groups.setdefault(wake_dice[pid], []).append(pid)

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
                    "wake_dice": wake_dice[pid],
                    "actions": [],
                }
                # Show outsider tag
                if player.outsider:
                    outsider_labels = {
                        "drunk": "� 酒鬼鼠",
                        "dodobird": "🐦 呆呆鸟",
                        "tom": "🐱 Tom（刺客）",
                        "jerry": "� Jerry（先知）",
                    }
                    entry["outsider"] = player.outsider
                    entry["outsider_label"] = outsider_labels.get(player.outsider, player.outsider)
                if player.hex_skill:
                    hex_labels = {
                        "perception_interference": "🌀 感知干涉",
                        "time_warp": "⏳ 时空错乱",
                    }
                    entry["hex_skill"] = player.hex_skill
                    entry["hex_skill_label"] = hex_labels.get(player.hex_skill, player.hex_skill)
                # Show display_dice if different from actual
                if player.display_dice != player.dice:
                    entry["display_dice"] = player.display_dice

                if player.role == Role.THIEF:
                    self._build_thief_log(entry, night, player)
                elif player.outsider == "drunk":
                    self._build_drunk_log(entry, night, player)
                elif player.role == Role.DODOBIRD:
                    self._build_dodobird_log(entry, night, player)
                elif player.role == Role.JERRY:
                    self._build_jerry_log(entry, night, player, pid)
                elif player.is_accomplice:
                    self._build_accomplice_log(entry, night, player)
                else:
                    self._build_mouse_log(entry, night, player, pid)

                # Outsider-specific action log entries
                self._build_outsider_tags(entry, player, pid)

                # Hex skill victim tags
                self._build_hex_tags(entry, player, pid)

                # Poison victim tag
                if pid == self.poison_target_id and self.hex_type == "perception_interference" and self.poison_fake_dice:
                    if self.poison_mode == "wrong_time":
                        entry["actions"].append(f"☠️ 被黑暗料理迷惑，在{self.poison_fake_dice}点时醒来（实际{player.dice}点）")
                    else:
                        entry["actions"].append(f"☠️ 被黑暗料理迷惑，看到了错误的信息（以为周围是{self.poison_fake_dice}点的玩家）")

                # Swap victim tag
                if self.swap_info and pid in (self.swap_info['pid1'], self.swap_info['pid2']):
                    if player.hex_skill != "time_warp":  # don't double-tag the hex holder
                        other_pid = self.swap_info['pid2'] if pid == self.swap_info['pid1'] else self.swap_info['pid1']
                        other_dice = self.players[other_pid].dice
                        entry["actions"].append(f"⏳ 被时空错乱影响，在{other_dice}点时醒来（自己骰子{player.dice}点）")

                # Fake accomplice victim tag (chosen by dodobird but not real accomplice)
                if (self.dodobird_accomplice_id and pid == self.dodobird_accomplice_id
                        and not player.is_accomplice and player.role != Role.DODOBIRD):
                    entry["actions"].append("🐦 被呆呆鸟选为假共犯（以为是大盗选的，实际不是真共犯）")

                # Vote info
                if player.voted_for:
                    target = self.players.get(player.voted_for)
                    if target:
                        entry["actions"].append(f"🗳️ 投票给了 {target.name}")

                log.append(entry)
        return log

    def _build_thief_log(self, entry: dict, night: dict, player):
        """Build action log entries for the thief."""
        entry["actions"].append("🧀 偷走了奶酪")
        if self.thief_raw_accomplice_id:
            raw_acc = self.players.get(self.thief_raw_accomplice_id)
            if raw_acc:
                entry["actions"].append(f"🤝 选择了 {raw_acc.name} 作为共犯")
            # Thief chose drunk mouse
            if self.thief_raw_accomplice_id == self.outsider_id and self.outsider_type == "drunk":
                if self.accomplice_id:
                    real_acc = self.players.get(self.accomplice_id)
                    if real_acc:
                        entry["actions"].append(f"🍺 实际共犯被酒鬼鼠转移给了 {real_acc.name}")
                elif self.drunk_accomplice_id == self.thief_id:
                    entry["actions"].append("🍺↔️ 酒鬼鼠也选了你→互选导致本局没有共犯！")

    def _build_drunk_log(self, entry: dict, night: dict, player):
        """Build action log entries for the drunk mouse."""
        entry["actions"].append("🍺 以为自己是大盗，全程闭眼睡觉")
        if self.drunk_accomplice_id:
            drunk_acc = self.players.get(self.drunk_accomplice_id)
            if drunk_acc:
                entry["actions"].append(f"🤝 选择了 {drunk_acc.name} 作为\u201c共犯\u201d")
            if self.thief_raw_accomplice_id == self.outsider_id:
                # Drunk was picked by thief, check if mutual selection
                if self.drunk_accomplice_id == self.thief_id:
                    entry["actions"].append("🍺↔️ 你选了真大盗→互选导致本局没有共犯！")
                else:
                    entry["actions"].append("✅ 被真大盗选中，共犯选择生效！")
            else:
                entry["actions"].append("❌ 未被真大盗选中，共犯选择未生效")

    def _build_dodobird_log(self, entry: dict, night: dict, player):
        """Build action log entries for the dodobird."""
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
        # Dodobird's fake accomplice choice
        if self.dodobird_accomplice_id:
            fake_acc = self.players.get(self.dodobird_accomplice_id)
            if fake_acc:
                if self.dodobird_accomplice_id == self.accomplice_id:
                    entry["actions"].append(f"🐦🤝 选了 {fake_acc.name} 为假共犯（与大盗同选，实际为真共犯）")
                else:
                    entry["actions"].append(f"🐦🤝 选了 {fake_acc.name} 为假共犯（{fake_acc.name} 以为是大盗选的）")

    def _build_accomplice_log(self, entry: dict, night: dict, player):
        """Build action log entries for the accomplice."""
        thief = self.players.get(self.thief_id)
        if thief:
            if self.thief_raw_accomplice_id == self.outsider_id:
                entry["actions"].append(f"🤝 被🍺酒鬼鼠间接选为共犯（真大盗: {thief.name}）")
            else:
                entry["actions"].append(f"🤝 被 {thief.name} 选为共犯")

    def _build_mouse_log(self, entry: dict, night: dict, player, pid: str):
        """Build action log entries for a regular mouse."""
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

    def _build_jerry_log(self, entry: dict, night: dict, player, pid: str):
        """Build action log entries for Jerry."""
        entry["actions"].append("🐭 作为 Jerry，知道所有人的骰子点数和大盗身份")
        # Also show normal mouse actions
        same_group = night.get("same_group", [])
        if same_group:
            names = "、".join(m["name"] for m in same_group)
            entry["actions"].append(f"👀 与 {names} 同时睁眼")
            if night.get("thief_spotted"):
                entry["actions"].append(f"🚨 发现了大盗 {night.get('spotted_thief_name')}")
        if night.get("has_peeked"):
            entry["actions"].append(f"🔍 偷看了 {night.get('peek_target_name')} 的骰子: {night.get('peek_result')} 点")
        if night.get("cheese_stolen"):
            entry["actions"].append("⚠️ 发现奶酪被偷")

    def _build_outsider_tags(self, entry: dict, player, pid: str):
        """Add outsider-specific tags to the action log entry."""
        # Tom assassination info
        if player.outsider == "tom" and self.assassinate_target_id:
            target = self.players.get(self.assassinate_target_id)
            if target:
                if self.assassinate_result == "success":
                    entry["actions"].append(f"🐱🗡️ 刺杀了 {target.name}，命中 Jerry！大盗阵营获胜")
                elif self.assassinate_result == "fail":
                    entry["actions"].append(f"🐱❌ 刺杀了 {target.name}，但不是 Jerry")
                elif self.assassinate_result == "timeout":
                    entry["actions"].append("🐱⏰ 刺杀超时，未能行动")

    def _build_hex_tags(self, entry: dict, player, pid: str):
        """Add hex skill tags to the action log entry."""
        if player.hex_skill == "perception_interference":
            poison_target = self.players.get(self.poison_target_id)
            if poison_target and self.poison_fake_dice:
                if self.poison_mode == "wrong_time":
                    entry["actions"].append(f"� 感知干涉迷惑了 {poison_target.name}，TA在{self.poison_fake_dice}点时醒来（实际{poison_target.dice}点）")
                else:
                    entry["actions"].append(f"� 感知干涉迷惑了 {poison_target.name}，TA看到了错误的信息（以为周围是{self.poison_fake_dice}点的玩家）")
        elif player.hex_skill == "time_warp" and self.swap_info:
            p1_name = self.players[self.swap_info['pid1']].name
            p2_name = self.players[self.swap_info['pid2']].name
            entry["actions"].append(f"⏳ 时空错乱让 {p1_name} 和 {p2_name} 在对方的骰子点数时间醒来")
