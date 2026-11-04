"""Readiness cancellation, duplicate tabs, Redis recovery and real host failover.

Run on dify, exclusively against chesse-bluff-test on 18089.
"""
import asyncio
import json
import os
import subprocess
import time
import uuid
import websockets
from smoke_lobby import Client, req, WS_BASE
from waiting_client import configure_and_ready

CONTAINER = 'chesse-bluff-test-backend-1'

async def main():
    if os.environ.get('BLUFF_RESTART_CONTAINER') != CONTAINER or ':18089' not in WS_BASE:
        raise SystemExit('Requires BLUFF_RESTART_CONTAINER=chesse-bluff-test-backend-1 and LOBBY_URL on 18089')
    ids=['waiting_'+uuid.uuid4().hex[:10] for _ in range(2)]
    rid=(await req('/lobby/rooms',{'player_id':ids[0],'name':'自动开局测试','avatar':'🐭','game_id':'holdem'}))['id']
    await req(f'/lobby/rooms/{rid}/join',{'player_id':ids[1],'name':'朋友','avatar':'🐱'})
    clients=[];games=[]
    async def connect_lobby():
        for c in clients:await c.close()
        clients.clear()
        for pid in ids:
            c=Client(await websockets.connect(f'{WS_BASE}/lobby/rooms/{rid}/ws/{pid}'))
            await c.wait('room_state');clients.append(c)
    async def state():return await req(f'/lobby/rooms/{rid}?player_id={ids[0]}')
    async def ready_all():
        r=await state()
        await asyncio.gather(*(req(f'/lobby/rooms/{rid}/ready',{'player_id':p,'ready':True,'revision':r['revision']}) for p in ids))
        return await state()
    async def restart():
        await asyncio.to_thread(subprocess.run,['docker','restart',CONTAINER],check=True,capture_output=True)
        for _ in range(80):
            try:await req('/lobby/games');return
            except Exception:await asyncio.sleep(.2)
        raise AssertionError('Restart failed')
    try:
        await connect_lobby()
        r=await ready_all();assert r['stage']=='countdown' and not r.get('session_id')
        assert 2 < r['countdown']['deadline']-r['server_time'] <= 3
        await req(f'/lobby/rooms/{rid}/ready',{'player_id':ids[1],'ready':False,'revision':r['revision']})
        await asyncio.sleep(3.2)
        assert (await state())['stage']=='waiting'
        # The newest tab replaces the previous connection without marking the player offline.
        duplicate=Client(await websockets.connect(f'{WS_BASE}/lobby/rooms/{rid}/ws/{ids[1]}'))
        await duplicate.wait('room_state');await asyncio.sleep(.1)
        assert (await state())['members'][ids[1]]['connected']
        await clients[1].close();clients[1]=duplicate
        old=await ready_all()
        await req(f'/lobby/rooms/{rid}/game',{'player_id':ids[0],'game_id':'holdem','options':{'sb_amount':20}})
        fresh=await state();assert not fresh['countdown'] and all(not p['ready'] for p in fresh['members'].values())
        try:await req(f'/lobby/rooms/{rid}/ready',{'player_id':ids[1],'ready':True,'revision':old['revision']})
        except AssertionError as exc:assert '409' in str(exc)
        else:raise AssertionError('Stale revision was accepted')
        await ready_all();await restart();await connect_lobby()
        r=await state();assert r['stage']=='waiting' and not r['countdown'] and not r.get('session_id')
        assert all(not p['ready'] for p in r['members'].values())
        print('PASS: cancel, settings invalidation, duplicate tab, restart cancels countdown',flush=True)
        await configure_and_ready(req,rid,ids[0],'holdem',ids)
        late='late_'+uuid.uuid4().hex[:8]
        joined=await req(f'/lobby/rooms/{rid}/join',{'player_id':late,'name':'迟到玩家','avatar':'🐸'})
        assert late in joined['pending_member_ids'] and late not in joined['seats'] and late not in joined['session_members']
        for pid in ids:
            c=Client(await websockets.connect(f'{WS_BASE}/holdem-ws/{rid}/{pid}'));games.append(c)
        snapshot=(await games[0].wait('room_state'))['room']
        await restart()
        for c in games:await c.close()
        games.clear();await connect_lobby()
        for pid in ids:
            c=Client(await websockets.connect(f'{WS_BASE}/holdem-ws/{rid}/{pid}'));games.append(c)
        after=(await games[0].wait('room_state'))['room']
        recovered=await state();assert late in recovered['pending_member_ids'] and late not in recovered['session_members']
        assert after['hand']==snapshot['hand'] and after['hand_number']==snapshot['hand_number']==1
        assert {p:v['chips'] for p,v in after['players'].items()}=={p:v['chips'] for p,v in snapshot['players'].items()}
        actor=ids.index(after['hand']['current_player_id'])
        await games[actor].ws.send(json.dumps({'type':'action','action':'fold'}))
        await games[0].wait('room_state',lambda m:m['room']['status']=='waiting')
        await games[0].ws.send(json.dumps({'type':'end_game'}))
        await games[0].wait('room_state',lambda m:m['room']['status']=='finished')
        await req(f'/lobby/rooms/{rid}/return',{'player_id':ids[0]})
        print('PASS: candidate persists without game access, Holdem restart retains chips/hand, return keeps seats',flush=True)
        await clients[0].close()
        print('Waiting for real 60-second host failover…',flush=True)
        await asyncio.sleep(61)
        r=await req(f'/lobby/rooms/{rid}?player_id={ids[1]}')
        assert r['owner_id']==ids[1]
        print('PASS: owner disconnect automatically transfers after 60 seconds',flush=True)
        for pid in [late]+ids:await req(f'/lobby/rooms/{rid}/leave',{'player_id':pid})
    finally:
        for c in clients+games:await c.close()

if __name__=='__main__':asyncio.run(main())
