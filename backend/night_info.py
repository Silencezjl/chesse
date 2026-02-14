import random
from typing import Optional
from models import Role


class NightInfoMixin:
    """Mixin for night phase info computation and outsider assignment."""

    def _assign_outsider(self):
        """Randomly assign one outsider from enabled types: drunk, dodobird, tom_jerry."""
        enabled = self._outsider_settings_list()
        if not enabled:
            return

        outsider_type = random.choice(enabled)
        self.outsider_type = outsider_type

        mouse_ids = [pid for pid in self.players if pid != self.thief_id]

        if outsider_type == "drunk":
            # Must be a mouse (not the thief)
            if len(mouse_ids) < 2:
                self.outsider_type = None
                return
            self.outsider_id = random.choice(mouse_ids)
            self.players[self.outsider_id].outsider = "drunk"

        elif outsider_type == "dodobird":
            # Must be a mouse (not the thief)
            if not mouse_ids:
                self.outsider_type = None
                return
            self.outsider_id = random.choice(mouse_ids)
            self.dodobird_id = self.outsider_id
            self.players[self.outsider_id].role = Role.DODOBIRD
            self.players[self.outsider_id].outsider = "dodobird"

        elif outsider_type == "tom_jerry":
            # Tom & Jerry: actual assignment happens when thief chooses accomplice
            # Just mark that tom_jerry mode is active; no players assigned yet
            pass

    def _assign_hex_skill(self):
        """Randomly assign one hex skill from enabled types (independent of outsiders)."""
        enabled = self._hex_settings_list()
        if not enabled:
            return

        hex_type = random.choice(enabled)
        self.hex_type = hex_type

        if hex_type == "perception_interference":
            # Can be any player (thief or mouse)
            candidates = list(self.players.keys())
            self.hex_target_id = random.choice(candidates)
            self.players[self.hex_target_id].hex_skill = "perception_interference"
            # Poison a random other player
            others = [pid for pid in self.players if pid != self.hex_target_id]
            self.poison_target_id = random.choice(others)
            # Generate a fake dice value different from the target's real dice
            target_player = self.players[self.poison_target_id]
            possible_dice = [d for d in range(1, self.max_dice + 1) if d != target_player.dice]
            self.poison_fake_dice = random.choice(possible_dice)
            # Randomly choose poison mode
            self.poison_mode = random.choice(["wrong_time", "wrong_info"])
            if self.poison_mode == "wrong_time":
                target_player.display_dice = self.poison_fake_dice

        elif hex_type == "time_warp":
            # Can be any player (thief or mouse)
            candidates = list(self.players.keys())
            self.hex_target_id = random.choice(candidates)
            self.players[self.hex_target_id].hex_skill = "time_warp"
            # Pick two random players whose wake-up times will be swapped
            all_pids = list(self.players.keys())
            swap_pair = random.sample(all_pids, 2)
            p1, p2 = self.players[swap_pair[0]], self.players[swap_pair[1]]
            self.swap_info = {
                "pid1": swap_pair[0], "pid2": swap_pair[1],
                "dice1": p1.dice, "dice2": p2.dice,
            }

        elif hex_type in ("retirement_account", "handpicked"):
            # Only plain mice (白板瞌睡鼠): not thief, not outsider, not accomplice
            if self.accomplice_enabled:
                # Delay assignment until after accomplice is chosen
                self.hex_delayed = True
            else:
                # No accomplice concern, assign immediately
                plain_mice = [pid for pid in self.players
                              if pid != self.thief_id
                              and not self.players[pid].outsider
                              and self.players[pid].role != Role.DODOBIRD]
                if not plain_mice:
                    self.hex_type = None
                    return
                self.hex_target_id = random.choice(plain_mice)
                self.players[self.hex_target_id].hex_skill = hex_type

        elif hex_type == "lethal_tempo":
            # Can be any player (thief or mouse)
            candidates = list(self.players.keys())
            self.hex_target_id = random.choice(candidates)
            self.players[self.hex_target_id].hex_skill = "lethal_tempo"

    def _finalize_delayed_hex_skill(self):
        """Finalize delayed hex skill assignment after accomplice is chosen.
        Returns the assigned player_id or None."""
        if not self.hex_delayed:
            return None
        if self.hex_type not in ("retirement_account", "handpicked"):
            self.hex_delayed = False
            return None
        if self.hex_target_id is not None:
            self.hex_delayed = False
            return None  # already assigned

        # Find plain mice: not thief, not outsider, not accomplice
        plain_mice = [pid for pid in self.players
                      if pid != self.thief_id
                      and not self.players[pid].outsider
                      and not self.players[pid].is_accomplice
                      and self.players[pid].role not in (Role.DODOBIRD, Role.ACCOMPLICE)]
        if not plain_mice:
            self.hex_type = None
            self.hex_delayed = False
            return None

        self.hex_target_id = random.choice(plain_mice)
        self.players[self.hex_target_id].hex_skill = self.hex_type
        self.hex_delayed = False

        # Update night_info for the hex holder
        pid = self.hex_target_id
        if pid in self.night_info:
            hex_descriptions = {
                "retirement_account": "💰 你被赋予了海克斯科技「退休账户」！每当你获得一票，你投票的对象获得+2票。",
                "handpicked": "🎯 你被赋予了海克斯科技「精心挑选」！你的投票变为挑选，你无法投票。挑选一名玩家，让TA投票对象获得+2票。",
            }
            self.night_info[pid]["hex_skill"] = self.hex_type
            self.night_info[pid]["hex_skill_info"] = hex_descriptions.get(self.hex_type, "")

        return pid

    def compute_night_info(self):
        """Compute night phase info for each player based on dice groups."""
        # Drunk mouse is excluded from dice wake order (sleeps all night)
        drunk_id = self.outsider_id if self.outsider_type == "drunk" else None
        # Poisoned player: only excluded from normal grouping in wrong_time mode
        poison_pid = self.poison_target_id if self.hex_type == "perception_interference" else None
        poison_exclude = poison_pid if self.poison_mode == "wrong_time" else None

        # Build wake_dice map: the dice value that determines when a player wakes up
        # Normally wake_dice == player.dice, but trickster swaps wake-up times
        wake_dice: dict[str, int] = {}
        for pid, player in self.players.items():
            wake_dice[pid] = player.dice
        if self.swap_info and self.hex_type == "time_warp":
            pid1, pid2 = self.swap_info["pid1"], self.swap_info["pid2"]
            # Swap their wake-up times (use each other's dice for grouping)
            wake_dice[pid1] = self.swap_info["dice2"]
            wake_dice[pid2] = self.swap_info["dice1"]

        # Group players by wake_dice value (determines when they wake up)
        dice_groups: dict[int, list[str]] = {}
        for pid, player in self.players.items():
            if pid == drunk_id:
                continue  # drunk mouse doesn't wake up
            if pid == poison_exclude:
                continue  # wrong_time: poisoned player grouped separately
            dice_groups.setdefault(wake_dice[pid], []).append(pid)

        thief_dice = self.players[self.thief_id].dice

        # Compute normal night info for non-drunk players
        # (wrong_info poisoned player IS included here, will be overridden later)
        for pid, player in self.players.items():
            if pid == drunk_id or pid == poison_exclude:
                continue  # handled separately below

            group = dice_groups.get(wake_dice.get(pid, player.dice), [])
            info = {
                "role": player.role,
                "dice": player.dice,  # always show real dice
                "phase": "night",
            }

            if player.role == Role.THIEF:
                self._compute_thief_night_info(pid, player, group, info)
            elif player.role == Role.DODOBIRD:
                self._compute_dodobird_night_info(pid, player, group, thief_dice, info)
            else:
                self._compute_mouse_night_info(pid, player, group, thief_dice, info)

            # Hex skill info for this player
            if player.hex_skill == "perception_interference":
                info["hex_skill"] = "perception_interference"
                info["hex_skill_info"] = "🌀 你被赋予了海克斯科技「感知干涉」！你的能力迷惑了一名玩家，但你不知道是谁。"
            elif player.hex_skill == "time_warp":
                info["hex_skill"] = "time_warp"
                info["hex_skill_info"] = "⏳ 你被赋予了海克斯科技「时空错乱」！你的能力让两名玩家在对方的骰子点数时间醒来，但你不知道是谁。"
            elif player.hex_skill == "retirement_account":
                info["hex_skill"] = "retirement_account"
                info["hex_skill_info"] = "💰 你被赋予了海克斯科技「退休账户」！每当你获得一票，你投票的对象获得+2票。"
            elif player.hex_skill == "lethal_tempo":
                info["hex_skill"] = "lethal_tempo"
                info["hex_skill_info"] = f"🎵 你被赋予了海克斯科技「致命节奏」！如果白天讨论时长超过{len(self.players)}分钟（玩家人数），你获得+1票。"
            elif player.hex_skill == "handpicked":
                info["hex_skill"] = "handpicked"
                info["hex_skill_info"] = "🎯 你被赋予了海克斯科技「精心挑选」！你的投票变为挑选，你无法投票。挑选一名玩家，让TA投票对象获得+2票。"

            self.night_info[pid] = info

        # Apply poison effect
        if poison_pid:
            self._apply_poison_effect(dice_groups)

        # Handle drunk mouse: give them fake thief info
        if drunk_id:
            self._compute_drunk_night_info(drunk_id)

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
        """Compute night info for a regular mouse (not drunk).
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
                info["message"] = f"你是瞌睡鼠。你和 {names} 同时睁眼了，你们互相确认都是好老鼠🐭。"
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

    def _apply_poison_effect(self, dice_groups: dict):
        """Apply poison effect based on poison_mode.

        wrong_time: Player wakes at fake dice time, sees real players there, correct operations.
        wrong_info: Player wakes at correct time, but sees fake group members or gets fake peek results.
        """
        pid = self.poison_target_id
        player = self.players[pid]
        fake_dice = self.poison_fake_dice
        thief_dice = self.players[self.thief_id].dice

        if self.poison_mode == "wrong_time":
            # Player is excluded from normal grouping, joins fake dice group
            fake_group = dice_groups.get(fake_dice, [])
            virtual_group = fake_group + [pid]

            info = {
                "role": player.role,
                "dice": player.display_dice,  # shows fake dice
                "phase": "night",
                "is_poisoned": True,
            }

            if player.role == Role.THIEF:
                self._compute_thief_night_info(pid, player, virtual_group, info)
            elif player.role == Role.DODOBIRD:
                self._compute_dodobird_night_info(pid, player, virtual_group, thief_dice, info, perceived_dice=fake_dice)
            else:
                self._compute_mouse_night_info(pid, player, virtual_group, thief_dice, info, perceived_dice=fake_dice)

        elif self.poison_mode == "wrong_info":
            # Player is in their real group (already computed in main loop)
            # Override their night info with fake group's perspective
            fake_group = dice_groups.get(fake_dice, [])
            # Remove poisoned player from fake group if somehow present, then add them
            virtual_group = [p for p in fake_group if p != pid] + [pid]

            info = {
                "role": player.role,
                "dice": player.display_dice,  # shows real dice (unchanged)
                "phase": "night",
                "is_poisoned": True,
                "poison_wrong_info": True,  # flag for peek_dice to return fake result
            }

            if player.role == Role.THIEF:
                self._compute_thief_night_info(pid, player, virtual_group, info)
            elif player.role == Role.DODOBIRD:
                self._compute_dodobird_night_info(pid, player, virtual_group, thief_dice, info, perceived_dice=player.dice)
            else:
                # wrong_info: wake at correct time, so cheese_stolen uses real dice
                self._compute_mouse_night_info(pid, player, virtual_group, thief_dice, info, perceived_dice=player.dice)

        # If poisoned player also has a hex skill, preserve their hex info
        if player.hex_skill == "time_warp":
            info["hex_skill"] = "time_warp"
            info["hex_skill_info"] = "⏳ 你被赋予了海克斯科技「时空错乱」！你的能力让两名玩家在对方的骰子点数时间醒来，但你不知道是谁。"
        elif player.hex_skill == "retirement_account":
            info["hex_skill"] = "retirement_account"
            info["hex_skill_info"] = "💰 你被赋予了海克斯科技「退休账户」！每当你获得一票，你投票的对象获得+2票。"
        elif player.hex_skill == "lethal_tempo":
            info["hex_skill"] = "lethal_tempo"
            info["hex_skill_info"] = f"🎵 你被赋予了海克斯科技「致命节奏」！如果白天讨论时长超过{len(self.players)}分钟（玩家人数），你获得+1票。"
        elif player.hex_skill == "handpicked":
            info["hex_skill"] = "handpicked"
            info["hex_skill_info"] = "🎯 你被赋予了海克斯科技「精心挑选」！你的投票变为挑选，你无法投票。挑选一名玩家，让TA投票对象获得+2票。"

        self.night_info[pid] = info

    def _compute_drunk_night_info(self, drunk_id: str):
        """Compute fake thief-like night info for the drunk mouse."""
        player = self.players[drunk_id]
        info = {
            "role": Role.THIEF,  # drunk mouse thinks they're the thief
            "dice": player.display_dice,
            "phase": "night",
            "outsider_actual": "drunk",  # hidden: actual outsider type
            "is_drunk": True,  # flag for frontend
        }
        if self.thief_see_all_dice:
            # Show fake randomized dice for all players
            fake_dice = {}
            for p_id, p in self.players.items():
                fake_dice[p_id] = random.randint(1, self.max_dice)
            fake_dice[drunk_id] = player.display_dice  # own dice is real
            info["all_dice"] = fake_dice
            info["message"] = "你是奶酪大盗！你已经偷走了奶酪🧀。你可以查看所有人的骰子点数。"
            info["same_group"] = []
        else:
            info["same_group"] = []
            info["message"] = "你是奶酪大盗！你已经偷走了奶酪🧀。你独自睁眼。"
        info["can_choose_accomplice"] = self.accomplice_enabled
        info["can_peek"] = False
        self.night_info[drunk_id] = info

    def _compute_jerry_night_info(self, jerry_id: str):
        """Update Jerry's night info with all dice values and thief identity.
        Called after Tom/Jerry assignment (when thief chooses accomplice).
        Jerry retains their normal mouse night info but gains extra knowledge.
        """
        if jerry_id not in self.night_info:
            return
        info = self.night_info[jerry_id]
        thief_player = self.players[self.thief_id]
        info["is_jerry"] = True
        info["outsider"] = "jerry"
        info["all_dice"] = {p_id: p.dice for p_id, p in self.players.items()}
        info["thief_id"] = self.thief_id
        info["thief_name"] = thief_player.name
        info["jerry_message"] = (
            f"🐭 你是 Jerry！你知道所有人的骰子点数，"
            f"并且你知道奶酪大盗是 {thief_player.name}！\n"
            f"⚠️ 但要小心隐藏身份，不要被 Tom（刺客）发现！"
        )

    def get_player_night_info(self, player_id: str) -> dict:
        """Return night_info for a player, stripped of internal-only flags."""
        night = self.night_info.get(player_id, {})
        # Strip internal flags that should not be sent to the player
        internal_keys = {"is_poisoned", "outsider_actual"}
        return {k: v for k, v in night.items() if k not in internal_keys}
