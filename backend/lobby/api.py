"""Shared room API. Game state remains private to its game adapter."""
import asyncio
import json
import logging
from collections import defaultdict

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from lobby.games import GAMES
from lobby.rooms import LobbyRoom, RoomError, new_id
from lobby.runtime import CheeseRuntime, HoldemRuntime
from games.bluff.service import BluffRuntime

router = APIRouter(prefix="/lobby")
logger = logging.getLogger(__name__)
redis: Redis | None = None
runtimes = {}
locks = defaultdict(asyncio.Lock)
connections: dict[str, dict[str, WebSocket]] = defaultdict(dict)
transitions: set[str] = set()
ROOMS_KEY = "lobby:rooms:v1"
PREFIX = "lobby:room:v1:"
PLAYER_PREFIX = "lobby:player:v1:"


class Profile(BaseModel):
    player_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=12)
    avatar: str = Field(min_length=1, max_length=16)


class SelectGame(BaseModel):
    player_id: str = Field(min_length=1, max_length=80)
    game_id: str
    options: dict = Field(default_factory=dict)


def configure(client, manager, store, sockets, player_map):
    global redis, runtimes
    redis = client
    runtimes = {"cheese": CheeseRuntime(manager, store, sockets, player_map), "holdem": HoldemRuntime(), "bluff": BluffRuntime()}


async def reset_presence():
    """Connections never survive a server restart, even after an unclean shutdown."""
    if redis is None:
        return
    for room_id in await db().smembers(ROOMS_KEY):
        try:
            room = await load(room_id)
        except HTTPException:
            continue
        for member in room.data['members'].values():
            member['connected'] = False
        await save(room)
        if room.data['game_id'] in runtimes:
            await runtimes[room.data['game_id']].reset_presence(room_id)


def db():
    if redis is None:
        raise HTTPException(503, "大厅需要 Redis，请检查服务是否已启动")
    return redis


async def load(room_id: str) -> LobbyRoom:
    raw = await db().get(PREFIX + room_id)
    if not raw:
        raise HTTPException(404, "房间不存在")
    return LobbyRoom.restore(json.loads(raw))


async def save(room: LobbyRoom, *, add_player: str | None = None, remove_player: str | None = None):
    data = room.snapshot()
    pipe = db().pipeline()
    pipe.set(PREFIX + data['id'], json.dumps(data, ensure_ascii=False))
    pipe.sadd(ROOMS_KEY, data['id'])
    if add_player:
        pipe.set(PLAYER_PREFIX + add_player, data['id'])
    if remove_player:
        pipe.delete(PLAYER_PREFIX + remove_player)
    await pipe.execute()


async def current_state(data: dict):
    runtime = runtimes.get(data['game_id'])
    return await runtime.snapshot(data['id']) if runtime else None


async def public(room: LobbyRoom) -> dict:
    data = room.snapshot()
    state = await current_state(data) if data['game_id'] else None
    data.pop('game_state', None)
    data['game_phase'] = (state.get('phase') or state.get('status')) if state else None
    data['can_switch'] = bool(state and GAMES[data['game_id']].can_switch(state)) if data['game_id'] else True
    return data


async def publish(room: LobbyRoom):
    message = {"type": "room_state", "data": await public(room)}
    for ws in list(connections.get(room.data['id'], {}).values()):
        try:
            await ws.send_json(message)
        except Exception:
            pass


async def detach_game(data: dict):
    runtime = runtimes.get(data['game_id'])
    if runtime:
        await runtime.detach(data)


@router.get('/games')
async def games():
    return [{"id": game.id, "title": game.title} for game in GAMES.values()]


@router.get('/rooms')
async def list_rooms():
    result = []
    for room_id in sorted(await db().smembers(ROOMS_KEY)):
        try:
            result.append(await public(await load(room_id)))
        except HTTPException:
            continue
    return result


@router.post('/rooms')
async def create_room(profile: Profile):
    # Serialize room creation and joining on this single-worker server.
    async with locks['__membership__']:
        existing = await db().get(PLAYER_PREFIX + profile.player_id)
        if existing and not await db().exists(PREFIX + existing):
            await db().delete(PLAYER_PREFIX + profile.player_id)
            existing = None
        if existing:
            raise HTTPException(409, f"你已在房间 {existing} 中")
        for _ in range(100):
            room_id = new_id()
            if not await db().exists(PREFIX + room_id):
                break
        else:
            raise HTTPException(503, "无法分配房间号")
        try:
            room = LobbyRoom(room_id, profile.player_id, profile.name, profile.avatar)
        except RoomError as exc:
            raise HTTPException(400, str(exc)) from exc
        room.data['members'][profile.player_id]['connected'] = False
        await save(room, add_player=profile.player_id)
        return await public(room)


@router.get('/players/{player_id}/room')
async def player_room(player_id: str):
    room_id = await db().get(PLAYER_PREFIX + player_id)
    if room_id and not await db().exists(PREFIX + room_id):
        await db().delete(PLAYER_PREFIX + player_id)
        room_id = None
    return {'room_id': room_id}


@router.get('/rooms/{room_id}')
async def get_room(room_id: str, player_id: str):
    room = await load(room_id)
    if player_id not in room.data['members']:
        raise HTTPException(403, "你不是房间成员")
    return await public(room)


@router.post('/rooms/{room_id}/join')
async def join_room(room_id: str, profile: Profile):
    async with locks['__membership__']:
        async with locks[room_id]:
            existing = await db().get(PLAYER_PREFIX + profile.player_id)
            if existing and existing != room_id:
                raise HTTPException(409, f"请先离开房间 {existing}")
            room = await load(room_id)
            if room.data['game_id']:
                state = await current_state(room.data)
                if state is not None:
                    room.data['game_state'] = state
                if (profile.player_id not in room.data['members'] and state
                        and GAMES[room.data['game_id']].can_switch(state)):
                    transitions.add(room_id)
                    try:
                        await detach_game(room.snapshot())
                        room.data['game_id'] = None
                        room.data['game_state'] = None
                    finally:
                        transitions.discard(room_id)
            try:
                room.join(profile.player_id, profile.name, profile.avatar)
            except RoomError as exc:
                raise HTTPException(400, str(exc)) from exc
            room.data['members'][profile.player_id]['connected'] = bool(connections.get(room_id, {}).get(profile.player_id))
            await save(room, add_player=profile.player_id)
        await publish(room)
        return await public(room)


@router.post('/rooms/{room_id}/leave')
async def leave_room(room_id: str, player: dict):
    pid = player.get('player_id', '')
    async with locks['__membership__']:
        async with locks[room_id]:
            room = await load(room_id)
            data = room.snapshot()
            if pid not in data['members']:
                raise HTTPException(403, "你不是房间成员")
            if data['game_id']:
                state = await current_state(data)
                if not state or not GAMES[data['game_id']].can_switch(state):
                    raise HTTPException(409, "请等待当前游戏结束")
                transitions.add(room_id)
                try:
                    await detach_game(data)
                finally:
                    transitions.discard(room_id)
                room.data['game_id'] = None
                room.data['game_state'] = None
            try:
                room.leave(pid)
            except RoomError as exc:
                raise HTTPException(400, str(exc)) from exc
            if room.data['members']:
                await save(room, remove_player=pid)
            else:
                pipe = db().pipeline()
                pipe.delete(PLAYER_PREFIX + pid)
                pipe.delete(PREFIX + room_id)
                pipe.srem(ROOMS_KEY, room_id)
                await pipe.execute()
        await publish(room)
        return {'ok': True}


@router.post('/rooms/{room_id}/game')
async def select_game(room_id: str, request: SelectGame):
    async with locks[room_id]:
        room = await load(room_id)
        data = room.snapshot()
        if request.player_id != data['owner_id']:
            raise HTTPException(403, "只有房主可以选择游戏")
        if data['game_id']:
            latest = await current_state(data)
            if not latest or not GAMES[data['game_id']].can_switch(latest):
                raise HTTPException(409, "当前游戏尚未结束")
            data['game_state'] = latest
            room.data['game_state'] = latest
        try:
            room.select_game(request.player_id, request.game_id, request.options)
        except RoomError as exc:
            raise HTTPException(400, str(exc)) from exc
        new_data = room.snapshot()
        transitions.add(room_id)
        try:
            if data['game_id']:
                await detach_game(data)
            # Each runtime owns its private snapshot and connections.
            await runtimes[request.game_id].install(new_data)
            await save(room)
        except Exception:
            # Restore the previous completed session if installing the new one fails.
            try:
                await runtimes[request.game_id].detach(new_data)
                if data['game_id']:
                    await runtimes[data['game_id']].install(data)
                await save(LobbyRoom.restore(data))
            except Exception:
                logger.exception("Failed to restore room %s after game switch error", room_id)
            raise
        finally:
            transitions.discard(room_id)
    await publish(room)
    return await public(room)


@router.websocket('/rooms/{room_id}/ws/{player_id}')
async def room_socket(ws: WebSocket, room_id: str, player_id: str):
    try:
        room = await load(room_id)
    except HTTPException:
        await ws.close(code=4404)
        return
    if player_id not in room.data['members']:
        await ws.close(code=4403)
        return
    await ws.accept()
    connections[room_id][player_id] = ws
    async with locks[room_id]:
        room = await load(room_id)
        room.data['members'][player_id]['connected'] = True
        await save(room)
        runtime = runtimes.get(room.data['game_id'])
        if runtime and hasattr(runtime, 'presence_changed'):
            await runtime.presence_changed(room)
    await publish(room)
    try:
        while True:
            message = await ws.receive_json()
            if message.get('type') == 'ping':
                await ws.send_json({'type': 'pong'})
            elif message.get('type') == 'refresh':
                await ws.send_json({'type': 'room_state', 'data': await public(await load(room_id))})
    except WebSocketDisconnect:
        pass
    finally:
        if connections[room_id].get(player_id) is ws:
            connections[room_id].pop(player_id, None)
            async with locks[room_id]:
                try:
                    room = await load(room_id)
                    room.disconnect(player_id)
                    await save(room)
                    runtime = runtimes.get(room.data['game_id'])
                    if runtime and hasattr(runtime, 'presence_changed'):
                        await runtime.presence_changed(room)
                    await publish(room)
                except HTTPException:
                    pass
