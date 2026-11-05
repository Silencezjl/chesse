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

    async def test_spectator_cannot_request_vote(self):
        self.room.add_spectator(Player('spectator'))
        self.room.start_day()
        await main.handle_request_vote(self.ws, 'spectator', {})
        self.assertEqual(self.room.vote_request_count(), 0)
        self.assertEqual(self.room.phase, GamePhase.DAY)

    async def test_snapshot_writes_coalesce_and_detach_waits(self):
        started = asyncio.Event()
        release = asyncio.Event()
        snapshots = []

        async def save(snapshot):
            snapshots.append(snapshot)
            if len(snapshots) == 1:
                started.set()
                await release.wait()

        main.game_manager.rooms[self.room.id] = self.room
        self.addCleanup(main.game_manager.rooms.pop, self.room.id, None)
        with patch.object(main.state_store, 'save_room', side_effect=save):
            main.save_room_to_redis(self.room)
            await started.wait()
            self.room.max_dice = 7
            main.save_room_to_redis(self.room)
            self.room.max_dice = 8
            main.save_room_to_redis(self.room)
            flush = asyncio.create_task(main.flush_room_save(self.room.id))
            await asyncio.sleep(0)
            self.assertFalse(flush.done())
            release.set()
            await flush
        self.assertEqual(len(snapshots), 2)
        self.assertEqual(snapshots[-1]['max_dice'], 8)

    async def test_snapshot_cache_does_not_alias_mutable_game_state(self):
        main.game_manager.rooms[self.room.id] = self.room
        self.addCleanup(main.game_manager.rooms.pop, self.room.id, None)
        self.addCleanup(main.saved_snapshots.pop, self.room.id, None)
        main.saved_snapshots.pop(self.room.id, None)
        with patch.object(main.state_store, 'save_room', new_callable=AsyncMock) as save:
            main.save_room_to_redis(self.room)
            await main.flush_room_save(self.room.id)
            self.room.night_info['regression'] = {'done': True}
            main.save_room_to_redis(self.room)
            await main.flush_room_save(self.room.id)
            self.assertEqual(save.await_count, 2)
            self.assertNotIn('regression', save.await_args_list[0].args[0]['night_info'])

    async def test_replaced_cheese_connection_cannot_submit_queued_action(self):
        from types import SimpleNamespace
        from lobby import api

        replacement = AsyncMock()

        async def receive():
            main.connections['p0'] = replacement
            return '{"type":"vote","data":{"target_id":"p1"}}'

        self.ws.receive_text.side_effect = receive
        public_room = SimpleNamespace(data={
            'session_id': 'session', 'game_id': 'cheese', 'members': {'p0': {}},
            'pending_member_ids': [],
        })
        self.addCleanup(main.connections.pop, 'p0', None)
        with patch.object(api, 'socket_authorized', AsyncMock(return_value=True)), \
             patch.object(api, 'redis', True), \
             patch.object(api, 'db', return_value=SimpleNamespace(get=AsyncMock(return_value='room'))), \
             patch.object(api, 'load', AsyncMock(return_value=public_room)), \
             patch.dict(main.MESSAGE_HANDLERS, {'vote': AsyncMock()}):
            await main.websocket_endpoint(self.ws, 'p0')
            main.MESSAGE_HANDLERS['vote'].assert_not_awaited()
        self.assertIs(main.connections['p0'], replacement)
