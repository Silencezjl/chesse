import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import main
from game import Room
from models import GamePhase, Player


class HandlerRaceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.room = Room('test-room', 'p0')
        for i in range(5):
            self.room.add_player(Player(f'p{i}'))
        self.room.start_game()
        self.ws = AsyncMock()
        self.lookup = patch.object(main.game_manager, 'find_player_room', return_value=self.room)
        self.send_state = patch.object(main, 'send_room_state', new_callable=AsyncMock)
        self.broadcast = patch.object(main, 'broadcast_to_room', new_callable=AsyncMock)
        self.lookup.start()
        self.send_state.start()
        self.broadcast.start()
        self.addCleanup(patch.stopall)

    async def test_simultaneous_vote_requests_start_once(self):
        self.room.start_day()
        await asyncio.gather(*(main.handle_request_vote(self.ws, f'p{i}', {}) for i in range(5)))
        starts = [call for call in main.broadcast_to_room.await_args_list if call.args[1]['type'] == 'vote_start']
        self.assertEqual(len(starts), 1)
        self.assertEqual(self.room.phase, GamePhase.VOTING)

    async def test_simultaneous_votes_only_publish_one_result(self):
        self.room.start_voting()
        await asyncio.gather(*(main.handle_vote(self.ws, f'p{i}', {'target_id': f'p{(i+1)%5}'}) for i in range(5)))
        results = [call for call in main.broadcast_to_room.await_args_list if call.args[1]['type'] == 'game_result']
        self.assertEqual(len(results), 1)
        self.assertEqual(sum(results[0].args[1]['data']['vote_results'].values()), 5)

    async def test_spectator_cannot_request_vote_or_restart_game(self):
        self.room.add_spectator(Player('spectator'))
        self.room.start_day()
        await main.handle_request_vote(self.ws, 'spectator', {})
        self.assertEqual(self.room.vote_request_count(), 0)
        await main.handle_new_game(self.ws, 'p0', {})
        self.assertEqual(self.room.phase, GamePhase.DAY)
