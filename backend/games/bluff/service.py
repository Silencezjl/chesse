"""Private game transport, Redis persistence, and resumable server timer."""
import asyncio
import json
import logging
import time
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from games.bluff import engine

router = APIRouter()
logger = logging.getLogger(__name__)
PREFIX = 'lobby:game:bluff:room:'
sockets: dict[str, dict[str, WebSocket]] = defaultdict(dict)
timers: dict[str, asyncio.Task] = {}


def lobby():
    from lobby import api
    return api


async def load(room_id):
    raw = await lobby().db().get(PREFIX + room_id)
    return json.loads(raw) if raw else None


async def save(state):
    await lobby().db().set(PREFIX + state['id'], json.dumps(state, ensure_ascii=False))


async def broadcast(state):
    for pid, ws in list(sockets.get(state['id'], {}).items()):
        try:
            await ws.send_json({'type': 'state', 'data': engine.view(state, pid)})
        except Exception:
            logger.debug('Failed to send bluff state to %s', pid)


def cancel_timer(room_id):
    task = timers.pop(room_id, None)
    if task and task is not asyncio.current_task():
        task.cancel()


def schedule(state):
    cancel_timer(state['id'])
    if state['phase'] == 'viewing' and not state['paused']:
        timers[state['id']] = asyncio.create_task(tick(state['id'], state['generation']))


async def tick(room_id, generation):
    try:
        while True:
            await asyncio.sleep(.25)
            async with lobby().locks[room_id]:
                state = await load(room_id)
                if not state or state.get('generation') != generation or state['phase'] != 'viewing' or state['paused']:
                    return
                changed = engine.advance_time(state)
                if not changed:
                    state['remaining'] = max(0.0, engine.remaining(state) - .25)
                await save(state)
                if changed:
                    await broadcast(state)
                    return
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception('Bluff timer failed in room %s', room_id)
    finally:
        if timers.get(room_id) is asyncio.current_task():
            timers.pop(room_id, None)


class BluffRuntime:
    async def snapshot(self, room_id):
        return await load(room_id)

    async def install(self, data):
        state = data['game_state']
        state['generation'] = data['session_id']
        await save(state)
        schedule(state)

    async def detach(self, data):
        room_id = data['id']
        cancel_timer(room_id)
        old = sockets.pop(room_id, {})
        for ws in old.values():
            await ws.close(code=1000)
        await lobby().db().delete(PREFIX + room_id)

    async def reset_presence(self, room_id):
        state = await load(room_id)
        if not state:
            return
        room = await lobby().load(room_id)
        engine.presence(state, room.data['members'], restarting=True)
        await save(state)
        schedule(state)

    async def presence_changed(self, room):
        state = await load(room.data['id'])
        if not state:
            return
        engine.presence(state, room.data['members'])
        await save(state)
        schedule(state)
        await broadcast(state)


@router.websocket('/bluff-ws/{room_id}/{player_id}')
async def game_socket(ws: WebSocket, room_id: str, player_id: str):
    api = lobby()
    try:
        room = await api.load(room_id)
    except Exception:
        await ws.close(code=4404); return
    if room_id in api.transitions or room.data['game_id'] != 'bluff' or player_id not in room.data['members']:
        await ws.close(code=4403); return
    await ws.accept()
    previous = sockets[room_id].get(player_id)
    sockets[room_id][player_id] = ws
    if previous and previous is not ws:
        await previous.close(code=1000)
    try:
        async with api.locks[room_id]:
            room = await api.load(room_id)
            state = await load(room_id)
            if not state or room.data['game_id'] != 'bluff' or state.get('generation') != room.data['session_id']:
                await ws.close(code=4404); return
            expired = engine.advance_time(state)
            await save(state)
            schedule(state)
            if expired:
                await broadcast(state)
            else:
                await ws.send_json({'type': 'state', 'data': engine.view(state, player_id)})
        while True:
            message = await ws.receive_json()
            if not isinstance(message, dict):
                await ws.send_json({'type': 'error', 'message': '无效操作数据'})
                continue
            if sockets.get(room_id, {}).get(player_id) is not ws:
                return
            async with api.locks[room_id]:
                room = await api.load(room_id)
                state = await load(room_id)
                if not state or room.data['game_id'] != 'bluff' or state.get('generation') != room.data['session_id']:
                    await ws.close(code=4404); return
                try:
                    engine.act(state, player_id, message.get('type', ''), message.get('data'))
                except engine.RuleError as exc:
                    await ws.send_json({'type': 'error', 'message': str(exc)})
                    continue
                await save(state)
                schedule(state)
                await broadcast(state)
                if state['phase'] == 'finished':
                    await api.publish(room)
    except WebSocketDisconnect:
        pass
    finally:
        if sockets.get(room_id, {}).get(player_id) is ws:
            sockets[room_id].pop(player_id, None)
