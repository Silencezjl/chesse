import unittest

from game import Room
from models import GamePhase, Player


class GameFlowTest(unittest.TestCase):
    def make_room(self, dodobird=False):
        room = Room("123456", "p0")
        for i in range(5):
            room.add_player(Player(f"p{i}", f"玩家{i}"))
        room.outsider_dodobird = dodobird
        room.start_game()
        return room

    def test_basic_game_and_snapshot_roundtrip(self):
        room = self.make_room()
        self.assertIsNone(room.dodobird_id)
        target = next(pid for pid in room.players if pid != room.thief_id)
        self.assertTrue(room.choose_accomplice(room.thief_id, target))
        restored = Room.deserialize(room.serialize())
        self.assertEqual(restored.phase, GamePhase.NIGHT)
        self.assertEqual(restored.accomplice_id, target)
        self.assertEqual(restored.get_room_state(target)["my_info"]["thief_id"], room.thief_id)
        restored.start_voting()
        for pid, player in restored.players.items():
            player.voted_for = target if pid in (room.thief_id, target) else room.thief_id
        result = restored.tally_votes()
        self.assertEqual(result["winner"], "mouse")
        self.assertEqual(sum(result["vote_results"].values()), 5)

    def test_dodobird_fake_accomplice_and_victory(self):
        for overlap in (False, True):
            with self.subTest(overlap=overlap):
                room = self.make_room(True)
                candidates = [p for p in room.players if p not in (room.thief_id, room.dodobird_id)]
                real, fake = candidates[0], candidates[0 if overlap else 1]
                self.assertTrue(room.choose_accomplice(room.thief_id, real))
                self.assertTrue(room.dodobird_choose_accomplice(room.dodobird_id, fake))
                info = room.get_room_state(fake)["my_info"]
                self.assertEqual(info["thief_id"], room.thief_id if overlap else room.dodobird_id)
                room.start_voting()
                self.assertFalse(room.cast_vote(room.thief_id, real)[0])
                for pid, player in room.players.items():
                    player.voted_for = room.thief_id if pid == room.dodobird_id else room.dodobird_id
                result = room.tally_votes()
                self.assertTrue(result["dodobird_win"])
                self.assertEqual(result["winner"], "dodobird")
                self.assertEqual(result["dodobird_accomplice_is_real"], overlap)

    def test_accomplice_identity_is_private_and_cannot_change(self):
        room = self.make_room(True)
        candidates = [p for p in room.players if p not in (room.thief_id, room.dodobird_id)]
        real, fake = candidates[:2]
        self.assertTrue(room.choose_accomplice(room.thief_id, real))
        self.assertFalse(room.choose_accomplice(room.thief_id, fake))
        self.assertEqual(room.get_room_state(real)["my_info"]["role"], "mouse")
        self.assertEqual(room.get_room_state(real)["players"][real]["role"], "mouse")
        self.assertTrue(room.dodobird_choose_accomplice(room.dodobird_id, fake))
        self.assertFalse(room.dodobird_choose_accomplice(room.dodobird_id, real))
        state = room.get_room_state(fake)
        self.assertEqual(state["players"][fake]["role"], "accomplice")
        self.assertTrue(state["players"][fake]["is_accomplice"])
        self.assertNotIn("is_fake_accomplice", state["my_info"])
        self.assertIn(room.players[room.dodobird_id].name, state["my_info"]["message"])
        self.assertEqual(room.get_room_state(real)["my_info"]["role"], "accomplice")

    def test_disconnected_player_is_not_skipped_and_cannot_self_vote(self):
        room = self.make_room()
        for pid in list(room.players)[1:]:
            room.mark_night_done(pid)
        room.players["p0"].connected = False
        self.assertFalse(room.all_night_actions_done())
        room.start_voting()
        self.assertFalse(room.cast_vote("p0", "p0")[0])

    def test_full_room_retains_spectators_for_next_game(self):
        room = self.make_room()
        for i in range(5, 8):
            room.players[f"p{i}"] = Player(f"p{i}")
        room.add_spectator(Player("spectator"))
        room.reset_for_new_game()
        self.assertIn("spectator", room.spectators)
        self.assertTrue(room.get_room_state("spectator")["is_spectator"])

    def test_old_snapshot_returns_to_waiting(self):
        room = self.make_room(True)
        data = room.serialize()
        data.pop("schema_version")
        restored = Room.deserialize(data)
        self.assertEqual(restored.phase, GamePhase.WAITING)
        self.assertEqual(len(restored.players), 5)
        self.assertTrue(restored.outsider_dodobird)


if __name__ == "__main__":
    unittest.main()
