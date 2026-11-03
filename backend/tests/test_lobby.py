import unittest

from lobby.rooms import LobbyRoom, RoomError


class LobbyRoomTest(unittest.TestCase):
    def make_room(self, count=5):
        room = LobbyRoom('123456', 'p0', '玩家0', '🐭')
        for i in range(1, count):
            room.join(f'p{i}', f'玩家{i}', '🐭')
        return room

    def test_capacity_and_owner_transfer(self):
        room = self.make_room(12)
        with self.assertRaises(RoomError):
            room.join('p12', '玩家12', '🐭')
        room.leave('p0')
        self.assertEqual(room.snapshot()['owner_id'], 'p1')

    def test_cheese_participants_and_game_switch(self):
        room = self.make_room(10)
        with self.assertRaises(RoomError):
            room.select_game('p1', 'cheese', {'participants': [f'p{i}' for i in range(5)]})
        room.select_game('p0', 'cheese', {'participants': [f'p{i}' for i in range(5)]})
        snapshot = room.snapshot()
        self.assertEqual(len(snapshot['game_state']['players']), 5)
        self.assertEqual(len(snapshot['game_state']['spectators']), 5)
        with self.assertRaises(RoomError):
            room.select_game('p0', 'holdem', {})
        snapshot['game_state']['phase'] = 'result'
        room = LobbyRoom.restore(snapshot)
        room.select_game('p0', 'holdem', {'initial_chips': 500})
        self.assertEqual(room.snapshot()['game_state']['players']['p1']['chips'], 500)
        with self.assertRaises(RoomError):
            room.select_game('p0', 'cheese', {'participants': [f'p{i}' for i in range(5)]})

    def test_invalid_selection_is_atomic(self):
        room = self.make_room()
        room.disconnect('p3')
        before = room.snapshot()
        with self.assertRaises(RoomError):
            room.select_game('p0', 'cheese', {'participants': [f'p{i}' for i in range(5)]})
        self.assertEqual(room.snapshot(), before)

    def test_holdem_new_session_resets_chips(self):
        room = self.make_room()
        room.select_game('p0', 'holdem', {'initial_chips': 1000})
        data = room.snapshot()
        data['game_state']['players']['p0']['chips'] = 5
        data['game_state']['status'] = 'finished'
        room = LobbyRoom.restore(data)
        room.select_game('p0', 'holdem', {'initial_chips': 1000})
        self.assertEqual(room.snapshot()['game_state']['players']['p0']['chips'], 1000)


if __name__ == '__main__':
    unittest.main()
