"""End-to-end test against an isolated lobby (creates a disposable room)."""
import asyncio
import json
import os
import subprocess
import urllib.error
import urllib.request
import uuid

import websockets

BASE = os.environ.get('LOBBY_URL', 'http://127.0.0.1:8088').rstrip('/')
WS = BASE.replace('http://', 'ws://', 1).replace('https://', 'wss://', 1)


def http(path, data=None):
    req = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(),
                                 headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)


async def request(path, data=None):
    return await asyncio.to_thread(http, path, data)


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.q = asyncio.Queue()
        self.task = asyncio.create_task(self.read())

    async def read(self):
        try:
            async for raw in self.ws:
                await self.q.put(json.loads(raw))
        except websockets.ConnectionClosed:
            pass

    async def send(self, kind, data=None):
        await self.ws.send(json.dumps({'type':kind, 'data':data or {}}))

    async def wait(self, kind, predicate=lambda data: True, timeout=15):
        async with asyncio.timeout(timeout):
            while True:
                msg = await self.q.get()
                if msg.get('type') == 'error' and kind != 'error':
                    raise AssertionError(msg)
                if msg.get('type') == kind and predicate(msg.get('data', msg)):
                    return msg.get('data', msg)

    async def close(self):
        await self.ws.close()
        await asyncio.gather(self.task, return_exceptions=True)


async def connect(path):
    return Client(await websockets.connect(WS + path))


async def main():
    ids = [f'bluff_test_{uuid.uuid4().hex[:10]}_{i}' for i in range(10)]
    people = [{'player_id': p, 'name': f'玩家{i}', 'avatar':'🐭'} for i,p in enumerate(ids)]
    room_id = (await request('/lobby/rooms', people[0]))['id']
    lobby, game = {}, {}
    try:
        for person in people[1:]:
            await request(f'/lobby/rooms/{room_id}/join', person)
        for pid in ids:
            lobby[pid] = await connect(f'/lobby/rooms/{room_id}/ws/{pid}')
            await lobby[pid].wait('room_state')
        await request(f'/lobby/rooms/{room_id}/game', {'player_id':ids[0], 'game_id':'bluff',
                                                       'options':{'participants':ids[:5], 'circles':1}})
        for pid in ids:
            game[pid] = await connect(f'/bluff-ws/{room_id}/{pid}')
        views = {pid: await game[pid].wait('state') for pid in ids}
        assert sum(v.get('my_role')=='honest' for v in views.values()) == 1
        assert all('my_role' not in views[p] for p in ids[5:])
        assert all('answer' not in v and 'history' not in v and 'roles' not in v for v in views.values())
        judge = next(p for p in ids[:5] if views[p]['my_role']=='judge')
        honest = next(p for p in ids[:5] if views[p]['my_role']=='honest')
        bluff = next(p for p in ids[:5] if views[p]['my_role']=='bluffer')
        await game[judge].send('draw', {'difficulty':2})
        for pid in ids:
            v = await game[pid].wait('state', lambda s:s['phase']=='prepare')
            assert len(v['question']['hints']) == 3 and 'answer' not in v
        for pid in ids[:5]:
            await game[pid].send('ready')
        for pid in ids:
            v = await game[pid].wait('state', lambda s:s['phase']=='viewing')
            assert ('answer' in v) == (pid == honest), (pid,v)
        await asyncio.sleep(1)
        disconnected = ids[1]
        await lobby[disconnected].close()
        v = await game[judge].wait('state', lambda s:s['phase']=='viewing' and s['paused'])
        remaining = v['remaining']
        await asyncio.sleep(1.25)
        await game[judge].send('ready')
        error = await game[judge].wait('error')
        assert '离线' in error['message']
        lobby[disconnected] = await connect(f'/lobby/rooms/{room_id}/ws/{disconnected}')
        await lobby[disconnected].wait('room_state')
        v = await game[judge].wait('state', lambda s:s['phase']=='viewing' and not s['paused'])
        assert abs(v['remaining'] - remaining) < .6
        for pid in ids:
            v = await game[pid].wait('state', lambda s:s['phase']=='discussion', timeout=15)
            assert 'answer' not in v and 'roles' not in v
        await game[judge].send('guess', {'target_id':honest})
        error = await game[judge].wait('error'); assert '质疑' in error['message']
        await game[judge].send('challenge', {'target_id':bluff})
        await game[judge].wait('state', lambda s:s['challenge_made'])
        await game[judge].send('guess', {'target_id':honest})
        for pid in ids:
            v = await game[pid].wait('state', lambda s:s['phase']=='reveal')
            assert v['result']['honest'] == honest
            assert v['result']['delta'][judge] == 3 and v['result']['delta'][honest] == 2
            assert v['result']['delta'][bluff] == -1
        await game[ids[0]].send('terminate')
        for pid in ids:
            v = await game[pid].wait('state', lambda s:s['phase']=='finished')
            assert v['terminated'] and len(v['history']) == 1
        await request(f'/lobby/rooms/{room_id}/game', {'player_id':ids[0], 'game_id':'holdem', 'options':{}})
        h = await connect(f'/holdem-ws/{room_id}/{ids[0]}')
        await h.wait('room_state')
        await h.ws.send(json.dumps({'type':'end_game'}))
        await h.wait('room_state',lambda m:m.get('room',{}).get('status')=='finished')
        await request(f'/lobby/rooms/{room_id}/game', {'player_id':ids[0], 'game_id':'cheese', 'options':{'participants':ids[:5]}})
        print('PASS: 10 members, private cards, pause/resume, 9-second timer, scoring, termination, Holdem and cheese switching')
        await h.close()
    finally:
        for client in list(game.values()) + list(lobby.values()):
            await client.close()


if __name__ == '__main__':
    asyncio.run(main())
