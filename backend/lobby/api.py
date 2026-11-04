"""Shared waiting room: the server owns readiness, countdown and session creation."""
import asyncio
import json
import logging
import time
import uuid
from collections import defaultdict

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from lobby.catalog import catalog
from lobby.games import GAMES
from lobby.rooms import LobbyRoom, RoomError, new_id
from lobby.runtime import CheeseRuntime, HoldemRuntime
from games.bluff.service import BluffRuntime

router = APIRouter(prefix='/lobby')
logger = logging.getLogger(__name__)
redis: Redis | None = None
runtimes = {}
locks = defaultdict(asyncio.Lock)
connections = defaultdict(dict)
transitions = set()
countdowns = {}
owner_timers = {}
ROOMS_KEY = 'lobby:rooms:v1'
PREFIX = 'lobby:room:v1:'
PLAYER_PREFIX = 'lobby:player:v1:'


class Profile(BaseModel):
    player_id: str = Field(min_length=1, max_length=80, pattern=r'^[a-zA-Z0-9_-]+$')
    name: str = Field(min_length=1, max_length=12)
    avatar: str = Field(min_length=1, max_length=16)
    game_id: str | None = None


class SelectGame(BaseModel):
    player_id: str = Field(min_length=1, max_length=80)
    game_id: str
    options: dict = Field(default_factory=dict)


class ReadyRequest(BaseModel):
    player_id: str
    ready: bool = Field(strict=True)
    revision: int


class SeatRequest(BaseModel):
    player_id: str
    target_id: str
    seated: bool = Field(strict=True)


class MemberRequest(BaseModel):
    player_id: str
    target_id: str | None = None


def configure(client, manager, store, sockets, player_map):
    global redis, runtimes
    redis = client
    runtimes = {'cheese': CheeseRuntime(manager, store, sockets, player_map),
                'holdem': HoldemRuntime(), 'bluff': BluffRuntime()}


def db():
    if redis is None:
        raise HTTPException(503, '大厅需要 Redis，请检查服务是否已启动')
    return redis


async def load(room_id):
    raw = await db().get(PREFIX + room_id)
    if not raw:
        raise HTTPException(404, '房间不存在')
    return LobbyRoom.restore(json.loads(raw))


async def save(room, *, add_player=None, remove_player=None):
    data = room.snapshot()
    pipe = db().pipeline()
    pipe.set(PREFIX + data['id'], json.dumps(data, ensure_ascii=False))
    pipe.sadd(ROOMS_KEY, data['id'])
    if add_player:
        pipe.set(PLAYER_PREFIX + add_player, data['id'])
    if remove_player:
        pipe.delete(PLAYER_PREFIX + remove_player)
    await pipe.execute()


async def current_state(data):
    runtime = runtimes.get(data['game_id'])
    return await runtime.snapshot(data['id']) if runtime and data.get('session_id') else None


async def sync(room):
    before = room.snapshot()
    if room.data['stage'] == 'playing':
        state = await current_state(room.data)
        if state and GAMES[room.data['game_id']].can_switch(state):
            room.data['stage'] = 'finished'
        elif state is None:
            room.data['stage'] = 'finished'
            room.data['start_error'] = '上局数据已过期，请由房主返回等待室重新组局。'
    room.failover()
    if before != room.data:
        await save(room)


async def public(room):
    await sync(room)
    data = room.snapshot()
    state = await current_state(data)
    for key in ('game_state', 'banned'):
        data.pop(key, None)
    data['game_phase'] = (state.get('phase') or state.get('status')) if state else None
    data['session_members'] = list(dict.fromkeys(list(state.get('players', {})) + list(state.get('spectators', {})))) if state else []
    if state and data['game_id'] == 'bluff':
        data['session_members'] = list(state.get('members', {}))
    data['can_switch'] = data['stage'] != 'playing'
    data['server_time'] = time.time()
    return data


async def publish(room):
    message = {'type': 'room_state', 'data': await public(room)}
    for ws in list(connections.get(room.data['id'], {}).values()):
        try:
            await ws.send_json(message)
        except Exception:
            pass


async def game_changed(room_id):
    try:
        async with locks[room_id]:
            await publish(await load(room_id))
    except HTTPException:
        pass
    except Exception:
        logger.exception('Failed to notify lobby %s', room_id)


async def detach_game(data):
    if data.get('session_id') and data['game_id'] in runtimes:
        await runtimes[data['game_id']].detach(data)


def member(room, pid):
    if pid not in room.data['members']:
        raise HTTPException(403, '你不是房间成员')


def rule(fn, *args):
    try:
        return fn(*args)
    except (RoomError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


def cancel_task(tasks, room_id):
    task = tasks.pop(room_id, None)
    if task and task is not asyncio.current_task():
        task.cancel()


async def reset_presence():
    if redis is None:
        return
    for tasks in (countdowns, owner_timers):
        for rid in list(tasks):
            cancel_task(tasks, rid)
    for rid in await db().smembers(ROOMS_KEY):
        try:
            room = await load(rid)
        except HTTPException:
            continue
        room.invalidate()
        room.data['owner_offline_since'] = time.time()
        for p in room.data['members'].values():
            p['connected'] = False
        await save(room)
        if room.data.get('session_id') and room.data['game_id'] in runtimes:
            await runtimes[room.data['game_id']].reset_presence(rid)


async def owner_timeout(rid, delay):
    try:
        await asyncio.sleep(delay)
        async with locks[rid]:
            room = await load(rid)
            await sync(room)
            await publish(room)
    except HTTPException:
        pass
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception('Owner failover failed in %s', rid)
    finally:
        if owner_timers.get(rid) is asyncio.current_task():
            owner_timers.pop(rid, None)


def watch_owner(room):
    rid = room.data['id']
    since = room.data.get('owner_offline_since')
    if since is not None and rid not in owner_timers:
        owner_timers[rid] = asyncio.create_task(owner_timeout(rid, max(0, since + 60 - time.time()) + .05))
    elif since is None:
        cancel_task(owner_timers, rid)


async def presence(room):
    await sync(room)
    watch_owner(room)
    runtime = runtimes.get(room.data['game_id'])
    if room.data.get('session_id') and runtime and hasattr(runtime, 'presence_changed'):
        await runtime.presence_changed(room)


async def launch(room):
    """Called once under the room lock, after rechecking countdown conditions."""
    data = room.snapshot()
    options = dict(data['options'])
    if data['game_id'] in ('cheese', 'bluff'):
        options['participants'] = data['seats']
    room.data['game_state'] = GAMES[data['game_id']].create(data, options)
    room.data['session_id'] = uuid.uuid4().hex
    room.data['stage'] = 'playing'
    room.data['countdown'] = None
    runtime = runtimes[data['game_id']]
    transitions.add(data['id'])
    try:
        await runtime.install(room.snapshot())
        if hasattr(runtime, 'begin'):
            await runtime.begin(room.snapshot())
        await save(room)
    except Exception:
        try:
            await runtime.detach(room.snapshot())
        except Exception:
            logger.exception('Failed to remove partial session %s', data['id'])
        room.data = data
        room.invalidate()
        room.data['stage'] = 'waiting'
        room.data['start_error'] = '开局失败，房间已保留。请重新准备后重试。'
        await save(room)
        raise
    finally:
        transitions.discard(data['id'])


async def finish_countdown(rid, token, deadline):
    try:
        await asyncio.sleep(max(0, deadline - time.time()))
        async with locks[rid]:
            room = await load(rid)
            active = room.data['countdown']
            if not active or active['token'] != token or active['revision'] != room.data['revision']:
                return
            if room.can_start():
                try:
                    await launch(room)
                except Exception:
                    logger.exception('Game launch failed in %s', rid)
            else:
                room.cancel_countdown()
                await save(room)
            await publish(room)
    except (asyncio.CancelledError, HTTPException):
        pass
    finally:
        if countdowns.get(rid) is asyncio.current_task():
            countdowns.pop(rid, None)


def schedule(room):
    rid = room.data['id']
    cancel_task(countdowns, rid)
    if room.data['countdown']:
        c = room.data['countdown']
        countdowns[rid] = asyncio.create_task(finish_countdown(rid, c['token'], c['deadline']))


@router.get('/games')
async def games():
    return catalog()


@router.get('/rooms')
async def list_rooms():
    # Invitations replace public enumeration of friends' room codes and identities.
    return []


@router.get('/rooms/{room_id}/preview')
async def preview(room_id: str):
    async with locks[room_id]:
        room = await load(room_id)
        await sync(room)
        d = room.data
        return dict(id=d['id'], game_id=d['game_id'], stage=d['stage'], count=len(d['members']),
                    owner_name=d['members'][d['owner_id']]['name'],
                    joinable=d['stage'] != 'playing' and len(d['members']) < 12)


@router.post('/rooms')
async def create_room(profile: Profile):
    async with locks['__membership__']:
        existing = await db().get(PLAYER_PREFIX + profile.player_id)
        if existing and await db().exists(PREFIX + existing):
            raise HTTPException(409, f'你已在房间 {existing} 中，请先返回该房间')
        for _ in range(100):
            rid = new_id()
            if not await db().exists(PREFIX + rid):
                break
        else:
            raise HTTPException(503, '无法分配房间号')
        room = rule(LobbyRoom, rid, profile.player_id, profile.name, profile.avatar)
        if profile.game_id:
            rule(room.configure_game, profile.player_id, profile.game_id, {})
        room.data['members'][profile.player_id]['connected'] = False
        room.failover()
        await save(room, add_player=profile.player_id)
        return await public(room)


@router.get('/players/{player_id}/room')
async def player_room(player_id: str):
    rid = await db().get(PLAYER_PREFIX + player_id)
    if rid and not await db().exists(PREFIX + rid):
        await db().delete(PLAYER_PREFIX + player_id)
        rid = None
    return {'room_id': rid}


@router.get('/rooms/{room_id}')
async def get_room(room_id: str, player_id: str):
    async with locks[room_id]:
        room = await load(room_id)
        member(room, player_id)
        return await public(room)


@router.post('/rooms/{room_id}/join')
async def join_room(room_id: str, profile: Profile):
    async with locks['__membership__']:
        async with locks[room_id]:
            existing = await db().get(PLAYER_PREFIX + profile.player_id)
            if existing and existing != room_id and await db().exists(PREFIX + existing):
                raise HTTPException(409, f'请先离开房间 {existing}')
            room = await load(room_id)
            await sync(room)
            rule(room.join, profile.player_id, profile.name, profile.avatar)
            room.data['members'][profile.player_id]['connected'] = bool(connections.get(room_id, {}).get(profile.player_id))
            await save(room, add_player=profile.player_id)
            schedule(room)
            await publish(room)
            return await public(room)


async def remove_member(room, pid):
    rid = room.data['id']
    rule(room.leave, pid)
    if room.data['members']:
        await save(room, remove_player=pid)
        await publish(room)
    else:
        await detach_game(room.data)
        pipe = db().pipeline()
        pipe.delete(PLAYER_PREFIX + pid)
        pipe.delete(PREFIX + rid)
        pipe.srem(ROOMS_KEY, rid)
        await pipe.execute()
        cancel_task(owner_timers, rid)
    schedule(room)
    socket = connections.get(rid, {}).pop(pid, None)
    if socket:
        await socket.close(code=4003)


@router.post('/rooms/{room_id}/leave')
async def leave_room(room_id: str, player: dict):
    async with locks['__membership__']:
        async with locks[room_id]:
            room = await load(room_id)
            pid = player.get('player_id', '')
            member(room, pid)
            await sync(room)
            await remove_member(room, pid)
    return {'ok': True}


@router.post('/rooms/{room_id}/game')
async def select_game(room_id: str, request: SelectGame):
    async with locks[room_id]:
        room = await load(room_id)
        member(room, request.player_id)
        await sync(room)
        if request.player_id != room.data['owner_id']:
            raise HTTPException(403, '只有房主可以设置游戏')
        rule(room.configure_game, request.player_id, request.game_id, request.options)
        await save(room)
        schedule(room)
        await publish(room)
        return await public(room)


@router.post('/rooms/{room_id}/ready')
async def ready(room_id: str, request: ReadyRequest):
    async with locks[room_id]:
        room = await load(room_id)
        member(room, request.player_id)
        rule(room.ready, request.player_id, request.ready, request.revision)
        room.arm()
        await save(room)
        schedule(room)
        await publish(room)
        return await public(room)


@router.post('/rooms/{room_id}/seat')
async def seat(room_id: str, request: SeatRequest):
    async with locks[room_id]:
        room = await load(room_id)
        rule(room.seat, request.player_id, request.target_id, request.seated)
        await save(room)
        schedule(room)
        await publish(room)
        return await public(room)


@router.post('/rooms/{room_id}/return')
async def return_room(room_id: str, request: MemberRequest):
    async with locks[room_id]:
        room = await load(room_id)
        member(room, request.player_id)
        await sync(room)
        if room.data['owner_id'] != request.player_id:
            raise HTTPException(403, '只有房主可以开启下一局')
        if room.data['stage'] != 'finished':
            raise HTTPException(409, '请等待当前游戏结束')
        transitions.add(room_id)
        try:
            await detach_game(room.data)
            room.data.update(stage='waiting', game_state=None, session_id=None)
            room.invalidate()
            await save(room)
        finally:
            transitions.discard(room_id)
        await publish(room)
        return await public(room)


@router.post('/rooms/{room_id}/manage')
async def manage(room_id: str, request: MemberRequest, action: str):
    async with locks['__membership__']:
        async with locks[room_id]:
            room = await load(room_id)
            member(room, request.player_id)
            await sync(room)
            if request.player_id != room.data['owner_id']:
                raise HTTPException(403, '只有房主可以管理成员')
            if action == 'transfer':
                rule(room.transfer, request.player_id, request.target_id)
                await save(room)
                await publish(room)
            elif action == 'kick':
                rule(room.editable)
                if request.target_id == request.player_id:
                    raise HTTPException(409, '请使用离开房间')
                member(room, request.target_id)
                room.data['banned'].append(request.target_id)
                await remove_member(room, request.target_id)
            else:
                raise HTTPException(400, '未知操作')
            return await public(room)


@router.websocket('/rooms/{room_id}/ws/{player_id}')
async def room_socket(ws: WebSocket, room_id: str, player_id: str):
    accepted = False
    try:
        async with locks[room_id]:
            room = await load(room_id)
            member(room, player_id)
            await ws.accept()
            accepted = True
            previous = connections[room_id].get(player_id)
            connections[room_id][player_id] = ws
            if previous and previous is not ws:
                await previous.close(code=4001)
            room.data['members'][player_id]['connected'] = True
            await presence(room)
            await save(room)
            await publish(room)
        while True:
            message = await ws.receive_json()
            if connections[room_id].get(player_id) is not ws:
                break
            if message.get('type') == 'ping':
                await ws.send_json({'type': 'pong'})
            elif message.get('type') == 'refresh':
                async with locks[room_id]:
                    room = await load(room_id)
                    member(room, player_id)
                    await publish(room)
    except HTTPException:
        if not accepted:
            await ws.close(code=4403)
    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        if accepted and connections[room_id].get(player_id) is ws:
            connections[room_id].pop(player_id, None)
            async with locks[room_id]:
                try:
                    room = await load(room_id)
                    room.disconnect(player_id)
                    await presence(room)
                    await save(room)
                    schedule(room)
                    await publish(room)
                except HTTPException:
                    pass
