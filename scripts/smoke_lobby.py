"""Exercise a full five-player lobby, cheese round and Holdem session.

Run against an isolated server: LOBBY_URL=http://127.0.0.1:8088 python scripts/smoke_lobby.py
"""
import asyncio
import json
import os
import subprocess
import urllib.error
import urllib.request
import urllib.parse
import http.cookiejar
import uuid

import websockets
from waiting_client import configure_and_ready

BASE = os.environ.get('LOBBY_URL', 'http://127.0.0.1:8088').rstrip('/')
WS_BASE = BASE.replace('http://', 'ws://', 1).replace('https://', 'wss://', 1)


openers = {}
cookies = {}

def identity():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    req = urllib.request.Request(BASE + '/lobby/identity', data=b'{}', headers={'Content-Type': 'application/json'})
    with opener.open(req, timeout=5) as response:
        player = json.load(response)['player_id']
    openers[player] = opener
    cookies[player] = '; '.join(f'{cookie.name}={cookie.value}' for cookie in jar)
    return player

async def connect(path, player):
    return await websockets.connect(WS_BASE + path, extra_headers={'Cookie': cookies[player]})

def request(path, data=None):
    req = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        player = (data or {}).get('player_id') or urllib.parse.parse_qs(urllib.parse.urlsplit(path).query).get('player_id', [None])[0]
        if not player and path.startswith('/lobby/players/'):
            player = path.split('/')[3]
        opener = openers.get(player, urllib.request.build_opener())
        with opener.open(req, timeout=5) as response:
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
    ids = [identity() for _ in range(5)]
    profiles = [{'player_id': p, 'name': f'测试{i}', 'avatar': '🐭'} for i, p in enumerate(ids)]
    room = (await req('/lobby/rooms', profiles[0]))['id']
    lobby_clients, games = [], []
    try:
        for profile in profiles[1:]:
            await req(f'/lobby/rooms/{room}/join', profile)
        spoof = urllib.request.Request(
            BASE + f'/lobby/rooms/{room}/password',
            data=json.dumps({'player_id': ids[0], 'password': 'fake-password'}).encode(),
            headers={'Content-Type': 'application/json'},
        )
        try:
            await asyncio.to_thread(openers[ids[1]].open, spoof, timeout=5)
        except urllib.error.HTTPError as exc:
            assert exc.code == 403
        else:
            raise AssertionError('A different device could impersonate the owner')
        try:
            await websockets.connect(f'{WS_BASE}/lobby/rooms/{room}/ws/{ids[0]}',
                                     extra_headers={'Cookie': cookies[ids[1]]})
        except websockets.InvalidStatusCode as exc:
            assert exc.status_code == 403
        else:
            raise AssertionError('A different device could connect as the owner')
        for pid in ids:
            lobby_clients.append(Client(await connect(f'/lobby/rooms/{room}/ws/{pid}', pid)))
        for client in lobby_clients:
            await client.wait('room_state')
        await asyncio.to_thread(denied, f'/lobby/rooms/{room}/game', {'player_id': ids[1], 'game_id': 'cheese', 'options': {'participants': ids}}, 403)
        await configure_and_ready(req, room, ids[0], 'cheese', ids, {'outsider_dodobird':True})
        await asyncio.to_thread(denied, f'/lobby/rooms/{room}/game', {'player_id': ids[0], 'game_id': 'holdem', 'options': {}}, 409)
        for pid in ids:
            games.append(Client(await connect(f'/ws/{pid}', pid)))
        for client in games:
            await client.wait('connected')
        for client in games:
            await client.send('get_game_info')
        infos = [(await client.wait('room_state', lambda m: bool(m['data'].get('my_info'))))['data']['my_info'] for client in games]
        if os.environ.get('CHEESE_RESTART_CONTAINER'):
            container = os.environ['CHEESE_RESTART_CONTAINER']
            if container != 'chesse-bluff-test-backend-1' or ':18089' not in BASE:
                raise AssertionError('Restart requires the dedicated 18089 test instance')
            await asyncio.to_thread(subprocess.run, ['docker', 'restart', container], check=True, capture_output=True)
            for client in games + lobby_clients:
                await client.close()
            games, lobby_clients = [], []
            for _ in range(60):
                try:
                    await req('/lobby/games')
                    break
                except Exception:
                    await asyncio.sleep(.25)
            for pid in ids:
                client = Client(await connect(f'/lobby/rooms/{room}/ws/{pid}', pid))
                await client.wait('room_state')
                lobby_clients.append(client)
            recovered = []
            for pid in ids:
                client = Client(await connect(f'/ws/{pid}', pid))
                games.append(client)
                await client.wait('connected')
                await client.send('get_game_info')
                recovered.append((await client.wait('room_state', lambda m: bool(m['data'].get('my_info'))))['data']['my_info'])
            assert [info['role'] for info in recovered] == [info['role'] for info in infos]
            infos = recovered
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
        await configure_and_ready(req, room, ids[0], 'holdem', ids[:2], {'initial_chips':1000})
        for client in games:
            await client.close()
        games = []
        for pid in ids:
            games.append(Client(await connect(f'/holdem-ws/{room}/{pid}', pid)))
        msg = await games[0].wait('room_state', lambda m: m['room']['status'] == 'playing')
        assert sum(p['chips'] + p['total_bet_this_hand'] for p in msg['room']['players'].values()) == 5000
        actor = ids.index(msg['room']['hand']['current_player_id'])
        await games[actor].ws.send(json.dumps({'type': 'action', 'action': 'fold'}))
        await games[0].wait('room_state', lambda m: m['room']['status'] == 'waiting')
        await games[0].ws.send(json.dumps({'type': 'end_game'}))
        await games[0].wait('room_state', lambda m: m['room']['status'] == 'finished')
        recovered = Client(await connect(f'/holdem-ws/{room}/{ids[0]}', ids[0]))
        restored = await recovered.wait('room_state')
        assert restored['room']['status'] == 'finished' and len(restored['standings']) == 2
        assert sum(p['net'] for p in restored['standings']) == 0
        await games[0].close()
        games[0] = recovered
        assert (await req(f'/lobby/rooms/{room}?player_id={ids[0]}'))['can_switch']
        print(f'PASS: {room}: public room → cheese → Holdem → fold → end game')
        for pid in ids[1:] + ids[:1]:
            await req(f'/lobby/rooms/{room}/leave', {'player_id': pid})
    finally:
        for client in games + lobby_clients:
            await client.close()


if __name__ == '__main__':
    asyncio.run(main())
