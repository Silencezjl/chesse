"""Verify automatic offline-room cleanup on the dedicated 18089 test instance.

Only backdate timestamps belonging to rooms created by this script. Never run
against a production endpoint; existing data and Redis volumes are untouched.
"""
import asyncio
import json
import subprocess
import time
import uuid
import websockets
from smoke_lobby import Client, req, WS_BASE
from waiting_client import configure_and_ready


async def main():
    if WS_BASE not in ('ws://localhost:18089', 'ws://127.0.0.1:18089'):
        raise SystemExit('Use LOBBY_URL=http://localhost:18089 (chesse-bluff-test only)')
    tag='expiry_'+uuid.uuid4().hex[:10]
    rooms=[];clients=[]
    async def create(suffix):
        pid=tag+suffix
        r=await req('/lobby/rooms',dict(player_id=pid,name='自动解散测试',avatar='🐭'))
        rooms.append((r['id'],[pid]))
        return r['id'],pid
    try:
        empty,p0=await create('_empty')
        active,p1=await create('_active')
        connected=Client(await websockets.connect(f'{WS_BASE}/lobby/rooms/{active}/ws/{p1}'))
        await connected.wait('room_state');clients.append(connected)
        playing,p2=await create('_game0');p3=tag+'_game1';rooms[-1][1].append(p3)
        await req(f'/lobby/rooms/{playing}/join',dict(player_id=p3,name='朋友',avatar='🐱'))
        game_lobby=[]
        for pid in (p2,p3):
            c=Client(await websockets.connect(f'{WS_BASE}/lobby/rooms/{playing}/ws/{pid}'))
            await c.wait('room_state');clients.append(c);game_lobby.append(c)
        await configure_and_ready(req,playing,p2,'holdem',[p2,p3])
        for c in game_lobby:await c.close()
        await asyncio.sleep(.2)
        # Backdate only this run's own room records. The live server's periodic
        # task must independently keep the active room and expire the other two.
        code="""import asyncio,json,time,sys,os
from redis.asyncio import Redis
async def run():
 r=Redis.from_url(os.environ['REDIS_URL'],decode_responses=True)
 for rid in sys.argv[2:]:
  key='lobby:room:v1:'+rid
  data=json.loads(await r.get(key))
  assert all(p.startswith(sys.argv[1]) for p in data['members'])
  data['empty_since']=time.time()-901
  await r.set(key,json.dumps(data))
 await r.aclose()
asyncio.run(run())"""
        await asyncio.to_thread(subprocess.run,['docker','exec','chesse-bluff-test-backend-1','python','-c',code,tag,empty,active,playing],check=True,capture_output=True)
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            listed={r['id'] for r in await req('/lobby/rooms')}
            assert active in listed,'Live room was removed'
            if empty not in listed and playing not in listed:break
            await asyncio.sleep(.5)
        else:raise AssertionError('Periodic cleanup did not remove expired rooms')
        for pid in (p0,p2,p3):assert (await req(f'/lobby/players/{pid}/room'))['room_id'] is None
        verify="""import asyncio,sys,os
from redis.asyncio import Redis
async def run():
 r=Redis.from_url(os.environ['REDIS_URL'],decode_responses=True)
 assert not await r.exists('lobby:room:v1:'+sys.argv[1])
 assert not await r.exists('lobby:room:v1:'+sys.argv[2])
 assert not await r.exists('lobby:game:holdem:room:'+sys.argv[2])
 await r.aclose()
asyncio.run(run())"""
        await asyncio.to_thread(subprocess.run,['docker','exec','chesse-bluff-test-backend-1','python','-c',verify,empty,playing],check=True,capture_output=True)
        await req(f'/lobby/rooms/{active}/leave',{'player_id':p1})
        print('PASS: actual periodic task expires waiting/playing rooms, preserves live room, removes memberships and Holdem state')
    finally:
        for c in clients:await c.close()


if __name__=='__main__':asyncio.run(main())
