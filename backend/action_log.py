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
        # Group by wake_dice value for ordering (reflects actual wake-up order)
        dice_groups: dict[int, list[str]] = {}
        for pid, player in self.players.items():
            dice_groups.setdefault(wake_dice[pid], []).append(pid)

        for dice_val in sorted(dice_groups.keys()):
            pids = dice_groups[dice_val]
            for pid in pids:
                player = self.players[pid]
                night = self.night_info.get(pid, {})
                # Map dodobird to mouse for display; outsider label handles identity
                display_role = player.role
                if player.role == Role.DODOBIRD:
                    display_role = Role.MOUSE
                entry = {
                    "player_id": pid,
                    "name": player.name,
                    "avatar": player.avatar,
                    "role": display_role,
                    "dice": player.dice,
                    "wake_dice": wake_dice[pid],
                    "actions": [],
                }
                # Show outsider tag
                if player.outsider:
                    entry["outsider"] = player.outsider
                    entry["outsider_label"] = "🐦 呆呆鸟"

                if player.role == Role.THIEF:
                    self._build_thief_log(entry, night, player)
                elif player.role == Role.DODOBIRD:
                    self._build_dodobird_log(entry, night, player)
                elif player.is_accomplice:
                    self._build_accomplice_log(entry, night, player)
                else:
                    self._build_mouse_log(entry, night, player, pid)

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
