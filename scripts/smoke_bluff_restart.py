"""Restart recovery test. Only runs against the dedicated test Compose project."""
import asyncio
import os
import subprocess
import uuid

from smoke_bluff import Client, connect, request


async def main():
    container = os.environ.get('BLUFF_RESTART_CONTAINER', '')
    if container != 'chesse-bluff-test-backend-1':
        raise SystemExit('Set BLUFF_RESTART_CONTAINER=chesse-bluff-test-backend-1; use only the isolated test project')
    ids = [f'bluff_restart_{uuid.uuid4().hex[:8]}_{i}' for i in range(3)]
    room_id = (await request('/lobby/rooms', {'player_id': ids[0], 'name': 'R0', 'avatar': '🐭'}))['id']
    lobby, game = {}, {}
    try:
        for i, pid in enumerate(ids[1:], 1):
            await request(f'/lobby/rooms/{room_id}/join', {'player_id': pid, 'name': f'R{i}', 'avatar': '🐭'})
        for pid in ids:
            lobby[pid] = await connect(f'/lobby/rooms/{room_id}/ws/{pid}')
            await lobby[pid].wait('room_state')
        await request(f'/lobby/rooms/{room_id}/game', {'player_id': ids[0], 'game_id': 'bluff', 'options': {'participants': ids, 'circles': 1}})
        for pid in ids:
            game[pid] = await connect(f'/bluff-ws/{room_id}/{pid}')
        initial = {pid: await game[pid].wait('state') for pid in ids}
        judge = next(pid for pid in ids if initial[pid]['my_role'] == 'judge')
        honest = next(pid for pid in ids if initial[pid]['my_role'] == 'honest')
        await game[judge].send('draw', {'difficulty': 1})
        for pid in ids:
            await game[pid].wait('state', lambda s: s['phase'] == 'prepare')
            await game[pid].send('ready')
        for pid in ids:
            state = await game[pid].wait('state', lambda s: s['phase'] == 'viewing')
            assert ('answer' in state) == (pid == honest)
        await asyncio.sleep(1.5)
        await asyncio.to_thread(subprocess.run, ['docker', 'restart', container], check=True, capture_output=True)
        for client in list(game.values()) + list(lobby.values()):
            await client.close()
        game, lobby = {}, {}
        for _ in range(60):
            try:
                await request('/lobby/rooms')
                break
            except Exception:
                await asyncio.sleep(.25)
        else:
            raise AssertionError('backend did not restart')
        # Reconnect the game sockets before the lobby sockets, so every device observes
        # the restored paused state before the final participant resumes the timer.
        for pid in ids:
            game[pid] = await connect(f'/bluff-ws/{room_id}/{pid}')
            state = await game[pid].wait('state')
            assert state['phase'] == 'viewing' and state['paused']
            assert state['my_role'] == initial[pid]['my_role']
            assert 0 < state['remaining'] < 8 and 'answer' not in state
        for pid in ids:
            lobby[pid] = await connect(f'/lobby/rooms/{room_id}/ws/{pid}')
            await lobby[pid].wait('room_state')
        state = await game[honest].wait('state', lambda s: s['phase'] == 'viewing' and not s['paused'])
        assert 'answer' in state
        for pid in ids:
            state = await game[pid].wait('state', lambda s: s['phase'] == 'discussion', timeout=12)
            assert 'answer' not in state and state['my_role'] == initial[pid]['my_role']
        await game[ids[0]].send('terminate')
        await game[ids[0]].wait('state', lambda s: s['phase'] == 'finished')
        print('PASS: Redis-backed restart restores room, roles and paused countdown without leaking answers')
    finally:
        for client in list(game.values()) + list(lobby.values()):
            await client.close()


if __name__ == '__main__':
    asyncio.run(main())
