"""Exercise a full five-player lobby, cheese round and Holdem session.

Run against an isolated server: LOBBY_URL=http://127.0.0.1:8088 python scripts/smoke_lobby.py
"""
import asyncio
import json
import os
import urllib.error
import urllib.request
import uuid

import websockets

BASE = os.environ.get('LOBBY_URL', 'http://127.0.0.1:8088').rstrip('/')
WS_BASE = BASE.replace('http://', 'ws://', 1).replace('https://', 'wss://', 1)


def request(path, data=None):
    req = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        raise AssertionError(f'{path}: {e.code} {e.read().decode()}') from e


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.q = asyncio.Queue()
        self.task = asyncio.create_task(self.read())

    async def read(self):
        try:
            async for item in self.ws:
                await self.q.put(json.loads(item))
        except websockets.ConnectionClosed:
            pass

    async def send(self, kind, data=None):
        await self.ws.send(json.dumps({'type': kind, 'data': data or {}}))

    async def wait(self, kind, check=lambda _: True):
        async with asyncio.timeout(12):
            while True:
                msg = await self.q.get()
                if msg.get('type') == 'error':
                    raise AssertionError(msg)
                if msg.get('type') == kind and check(msg):
                    return msg

    async def close(self):
        await self.ws.close()
        await asyncio.gather(self.task, return_exceptions=True)


def denied(path, data, status):
    try:
        request(path, data)
    except AssertionError as exc:
        assert f': {status} ' in str(exc), exc
    else:
        raise AssertionError(f'{path}: expected HTTP {status}')


async def req(path, data=None):
    return await asyncio.to_thread(request, path, data)


async def main():
    ids = [f'test_{uuid.uuid4().hex[:12]}' for _ in range(5)]
    profiles = [{'player_id': p, 'name': f'测试{i}', 'avatar': '🐭'} for i, p in enumerate(ids)]
    room = (await req('/lobby/rooms', profiles[0]))['id']
    lobby_clients, games = [], []
    try:
        for profile in profiles[1:]:
            await req(f'/lobby/rooms/{room}/join', profile)
        for pid in ids:
            lobby_clients.append(Client(await websockets.connect(f'{WS_BASE}/lobby/rooms/{room}/ws/{pid}')))
        for client in lobby_clients:
            await client.wait('room_state')
        await asyncio.to_thread(denied, f'/lobby/rooms/{room}/game', {'player_id': ids[1], 'game_id': 'cheese', 'options': {'participants': ids}}, 403)
        await req(f'/lobby/rooms/{room}/game', {'player_id': ids[0], 'game_id': 'cheese',
                                              'options': {'participants': ids, 'outsider_dodobird': True}})
        await asyncio.to_thread(denied, f'/lobby/rooms/{room}/game', {'player_id': ids[0], 'game_id': 'holdem', 'options': {}}, 409)
        for pid in ids:
            games.append(Client(await websockets.connect(f'{WS_BASE}/ws/{pid}')))
        for client in games:
            await client.wait('connected')
        for client in games:
            await client.send('ready', {'ready': True})
        infos = [(await client.wait('game_start'))['data'] for client in games]
        thief = next(i for i,x in enumerate(infos) if x['role'] == 'thief')
        bird = next(i for i,x in enumerate(infos) if x['role'] == 'dodobird')
        rest = [i for i in range(5) if i not in (thief, bird)]
        await games[thief].send('choose_accomplice', {'target_id': ids[rest[0]]})
        await games[thief].wait('accomplice_chosen')
        await games[bird].send('dodobird_choose_accomplice', {'target_id': ids[rest[1]]})
        await games[bird].wait('accomplice_chosen')
        for i, info in enumerate(infos):
            if info.get('can_peek'):
                await games[i].send('peek', {'target_id': ids[(i+1)%5]})
                await games[i].wait('peek_result')
        for client in games:
            await client.send('night_done')
        for client in games:
            await client.wait('day_start')
        for client in games[:3]:
            await client.send('request_vote')
        for client in games:
            await client.wait('vote_start')
        for i, client in enumerate(games):
            target = bird if i == thief or i == rest[0] else thief
            await client.send('vote', {'target_id': ids[target]})
        result = (await games[0].wait('game_result'))['data']
        assert sum(result['vote_results'].values()) == 5
        assert (await req(f'/lobby/rooms/{room}?player_id={ids[0]}'))['can_switch']
        await req(f'/lobby/rooms/{room}/game', {'player_id': ids[0], 'game_id': 'holdem', 'options': {'initial_chips': 1000}})
        for client in games:
            await client.close()
        games = []
        for pid in ids:
            games.append(Client(await websockets.connect(f'{WS_BASE}/holdem-ws/{room}/{pid}')))
        for client in games:
            msg = await client.wait('room_state')
            assert all(p['chips'] == 1000 for p in msg['room']['players'].values())
        for i in range(2):
            await games[i].ws.send(json.dumps({'type': 'sit', 'seat': i}))
            await games[i].wait('room_state', lambda m: m['room']['players'][ids[i]]['seat'] == i)
        for i in range(2):
            await games[i].ws.send(json.dumps({'type': 'ready'}))
        msg = await games[0].wait('room_state', lambda m: m['room']['status'] == 'playing')
        actor = ids.index(msg['room']['hand']['current_player_id'])
        await games[actor].ws.send(json.dumps({'type': 'action', 'action': 'fold'}))
        await games[0].wait('room_state', lambda m: m['room']['status'] == 'waiting')
        await games[0].ws.send(json.dumps({'type': 'end_game'}))
        await games[0].wait('room_state', lambda m: m['room']['status'] == 'finished')
        assert (await req(f'/lobby/rooms/{room}?player_id={ids[0]}'))['can_switch']
        print(f'PASS: {room}: public room → cheese → Holdem → fold → end game')
        for pid in ids[1:] + ids[:1]:
            await req(f'/lobby/rooms/{room}/leave', {'player_id': pid})
    finally:
        for client in games + lobby_clients:
            await client.close()


if __name__ == '__main__':
    asyncio.run(main())
