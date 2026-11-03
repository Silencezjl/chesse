from __future__ import annotations
import asyncio
import time
import uuid
import random
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    CreateRoomRequest, JoinRoomRequest, Room, Player,
    PlayerStatus, RoomStatus, HandPhase, ActionRequest,
    PlayerAction, SettlementVote, SeatRequest,
)
from .redis_manager import save_room, get_room, list_rooms, delete_room, close_redis
from .game_engine import (
    start_hand, process_action, get_seated_players,
    can_rebuy, do_rebuy, can_cashout, do_cashout, get_active_players,
    propose_settlement, confirm_settlement, reject_settlement,
    end_game,
)
from .ws_manager import manager


# Per-room locks to serialize state mutations and prevent race conditions
_room_locks: dict[str, asyncio.Lock] = {}


def get_room_lock(room_id: str) -> asyncio.Lock:
    if room_id not in _room_locks:
        _room_locks[room_id] = asyncio.Lock()
    return _room_locks[room_id]


EMOJIS = [
    "😀","😎","🤠","🦊","🐱","🐶","🐼","🦁","🐯","🐸",
    "🐵","🦄","🐲","🦅","🐧","🐨","🐰","🐷","🦋","🌟",
    "🔥","💎","🎯","🎲","👑","🃏","♠️","♥️","♦️","♣️",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background room cleanup task
    task = asyncio.create_task(room_cleanup_task())
    yield
    task.cancel()
    await close_redis()


async def room_cleanup_task():
    """Periodically clean up rooms with no online players for 10 minutes."""
    while True:
        await asyncio.sleep(10)
        try:
            rooms = await list_rooms()
            now = time.time()
            for r in rooms:
                online = any(p.is_connected for p in r.players.values())
                if online:
                    if r.last_all_disconnected_at is not None:
                        r.last_all_disconnected_at = None
                        await save_room(r)
                else:
                    if r.last_all_disconnected_at is None:
                        r.last_all_disconnected_at = now
                        await save_room(r)
                    elif now - r.last_all_disconnected_at > 600:  # 10 minutes
                        await delete_room(r.id)
                        _room_locks.pop(r.id, None)
        except Exception as e:
            print(f"Room cleanup error: {e}")


app = FastAPI(title="Holdem Chip Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def generate_player_id() -> str:
    return uuid.uuid4().hex[:12]


def generate_room_id() -> str:
    return uuid.uuid4().hex[:6].upper()


def random_name() -> str:
    names = ["Player", "Ace", "King", "Queen", "Jack", "Joker", "Shark", "Fish",
             "Whale", "Tiger", "Eagle", "Fox", "Wolf", "Bear", "Hawk", "Lion"]
    return f"{random.choice(names)}_{random.randint(10,99)}"


def room_to_broadcast(room: Room) -> dict:
    """Convert room to a dict suitable for broadcasting to all clients."""
    data = json.loads(room.model_dump_json())
    return {"type": "room_state", "room": data}


# ─── REST Endpoints ───

async def remove_player_from_all_rooms(player_id: str):
    """Remove a player from any room they're currently in."""
    rooms = await list_rooms()
    for r in rooms:
        if player_id in r.players:
            async with get_room_lock(r.id):
                room = await get_room(r.id)
                if room and player_id in room.players:
                    player = room.players[player_id]
                    if player.seat >= 0:
                        room.seats[player.seat] = None
                    del room.players[player_id]
                    await save_room(room)
                    await manager.broadcast(room.id, room_to_broadcast(room))


@app.post("/api/rooms")
async def create_room(req: CreateRoomRequest):
    room_id = generate_room_id()
    player_id = req.device_id or generate_player_id()

    # Remove player from any existing rooms
    await remove_player_from_all_rooms(player_id)

    player = Player(
        id=player_id,
        name=req.player_name,
        emoji=req.player_emoji,
        chips=req.initial_chips,
    )

    room = Room(
        id=room_id,
        owner_id=player_id,
        sb_amount=req.sb_amount,
        initial_chips=req.initial_chips,
        rebuy_minimum=req.rebuy_minimum,
        hand_interval=req.hand_interval,
        max_chips=req.max_chips,
        players={player_id: player},
    )

    await save_room(room)
    return {"room_id": room_id, "player_id": player_id}


@app.get("/api/rooms")
async def get_rooms():
    rooms = await list_rooms()
    result = []
    for r in rooms:
        if r.status != RoomStatus.WAITING:
            continue
        owner = r.players.get(r.owner_id)
        online_count = sum(1 for p in r.players.values() if p.is_connected)
        result.append({
            "id": r.id,
            "owner_name": owner.name if owner else "Unknown",
            "owner_emoji": owner.emoji if owner else "❓",
            "sb_amount": r.sb_amount,
            "bb_amount": r.bb_amount,
            "initial_chips": r.initial_chips,
            "player_count": online_count,
            "status": r.status.value,
        })
    return result


@app.post("/api/rooms/join")
async def join_room(req: JoinRoomRequest):
    player_id = req.device_id or generate_player_id()

    # Quick check before locking
    room = await get_room(req.room_id)
    if not room:
        raise HTTPException(404, "Room not found")

    # If player already in this room (reconnection), just return
    if player_id in room.players:
        return {"room_id": room.id, "player_id": player_id}

    # Remove player from any other rooms first
    await remove_player_from_all_rooms(player_id)

    async with get_room_lock(req.room_id):
        # Reload room state inside lock
        room = await get_room(req.room_id)
        if not room:
            raise HTTPException(404, "Room not found")

        player = Player(
            id=player_id,
            name=req.player_name,
            emoji=req.player_emoji,
            chips=room.initial_chips,
        )
        room.players[player_id] = player
        await save_room(room)

    # Broadcast updated room state
    await manager.broadcast(req.room_id, room_to_broadcast(room))

    return {"room_id": room.id, "player_id": player_id}


@app.get("/api/player-room/{player_id}")
async def get_player_room(player_id: str):
    """Check if a player is currently in an active room."""
    rooms = await list_rooms()
    for r in rooms:
        if player_id in r.players and r.status != RoomStatus.FINISHED:
            return {"room_id": r.id}
    return {"room_id": None}


@app.post("/api/rooms/{room_id}/leave/{player_id}")
async def leave_room_api(room_id: str, player_id: str):
    """Player intentionally leaves a room. Not allowed during active game."""
    async with get_room_lock(room_id):
        room = await get_room(room_id)
        if not room:
            return {"ok": True}
        if room.status == RoomStatus.PLAYING:
            raise HTTPException(400, "Cannot leave during game")
        player = room.players.get(player_id)
        if player:
            if player.seat >= 0:
                room.seats[player.seat] = None
            del room.players[player_id]
            # Transfer ownership if owner is leaving
            if player_id == room.owner_id and room.players:
                room.owner_id = next(iter(room.players))
            await save_room(room)
            await manager.broadcast(room_id, room_to_broadcast(room))
    return {"ok": True}


@app.get("/api/random-profile")
async def random_profile():
    return {"name": random_name(), "emoji": random.choice(EMOJIS)}


# ─── WebSocket ───

@app.websocket("/ws/{room_id}/{player_id}")
async def websocket_endpoint(ws: WebSocket, room_id: str, player_id: str):
    room = await get_room(room_id)
    if not room or player_id not in room.players:
        await ws.accept()
        await ws.close(code=4001, reason="Invalid room or player")
        return

    await manager.connect(room_id, player_id, ws)

    # Mark player connected under lock
    async with get_room_lock(room_id):
        room = await get_room(room_id)
        if room and player_id in room.players:
            room.players[player_id].is_connected = True
            room.last_all_disconnected_at = None
            await save_room(room)
            await manager.broadcast(room_id, room_to_broadcast(room))

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await manager.send_to_player(room_id, player_id, {
                    "type": "pong",
                    "timestamp": data.get("timestamp", 0),
                })
                continue

            # Acquire per-room lock to prevent concurrent state mutations
            async with get_room_lock(room_id):
                # Reload room state inside lock
                room = await get_room(room_id)
                if not room:
                    await ws.send_json({"type": "error", "message": "Room no longer exists"})
                    break

                if msg_type == "sit":
                    room, resp = handle_sit(room, player_id, data)
                elif msg_type == "stand":
                    room, resp = handle_stand(room, player_id)
                elif msg_type == "ready":
                    room, resp = handle_ready(room, player_id)
                elif msg_type == "action":
                    room, resp = handle_action(room, player_id, data)
                elif msg_type == "propose_settle":
                    room, resp = handle_propose_settle(room, player_id, data)
                elif msg_type == "confirm_settle":
                    room, resp = handle_confirm_settle(room, player_id)
                elif msg_type == "reject_settle":
                    room, resp = handle_reject_settle(room, player_id)
                elif msg_type == "rebuy":
                    room, resp = handle_rebuy(room, player_id)
                elif msg_type == "cashout":
                    room, resp = handle_cashout(room, player_id)
                elif msg_type == "end_game":
                    room, resp = handle_end_game(room, player_id)
                else:
                    resp = {"type": "error", "message": f"Unknown message type: {msg_type}"}

                await save_room(room)

                if resp.get("type") == "error":
                    await manager.send_to_player(room_id, player_id, resp)
                else:
                    await manager.broadcast(room_id, room_to_broadcast(room))
                    if resp.get("type") == "event":
                        await manager.broadcast(room_id, resp)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WS error: {e}")
    finally:
        manager.disconnect(room_id, player_id)
        async with get_room_lock(room_id):
            room = await get_room(room_id)
            if room and player_id in room.players:
                room.players[player_id].is_connected = False
                # Track when all players disconnected for auto-cleanup
                if not any(p.is_connected for p in room.players.values()):
                    room.last_all_disconnected_at = time.time()
                await save_room(room)
                await manager.broadcast(room_id, room_to_broadcast(room))
                await manager.broadcast(room_id, {
                    "type": "event",
                    "event": "player_disconnected",
                    "detail": f"{room.players[player_id].name} 已掉线",
                    "player_id": player_id
                })


# ─── Message Handlers ───

def handle_sit(room: Room, player_id: str, data: dict) -> tuple[Room, dict]:
    seat_index = data.get("seat", -1)
    if seat_index < 0 or seat_index >= 12:
        return room, {"type": "error", "message": "Invalid seat"}

    if room.seats.get(seat_index) is not None:
        return room, {"type": "error", "message": "Seat taken"}

    if room.status == RoomStatus.PLAYING:
        return room, {"type": "error", "message": "Game in progress"}

    player = room.players[player_id]

    # Remove from old seat if any
    if player.seat >= 0:
        room.seats[player.seat] = None

    player.seat = seat_index
    room.seats[seat_index] = player_id
    player.status = PlayerStatus.ACTIVE
    player.ready = False

    return room, {"type": "event", "event": "sit", "player_id": player_id, "seat": seat_index}


def handle_stand(room: Room, player_id: str) -> tuple[Room, dict]:
    if room.status == RoomStatus.PLAYING:
        return room, {"type": "error", "message": "Cannot stand during game"}

    player = room.players[player_id]
    if player.seat >= 0:
        room.seats[player.seat] = None
    player.seat = -1
    player.status = PlayerStatus.SITTING_OUT
    player.ready = False

    return room, {"type": "event", "event": "stand", "player_id": player_id}


def handle_ready(room: Room, player_id: str) -> tuple[Room, dict]:
    if room.status == RoomStatus.PLAYING:
        return room, {"type": "error", "message": "Game already in progress"}

    player = room.players[player_id]
    if player.seat < 0:
        return room, {"type": "error", "message": "Must sit first"}

    player.ready = not player.ready

    # Check if all seated players are ready (at least 2)
    seated = get_seated_players(room)
    if len(seated) >= 2 and all(p.ready for p in seated):
        room = start_hand(room)
        return room, {"type": "event", "event": "hand_started"}

    return room, {"type": "event", "event": "ready_toggle", "player_id": player_id, "ready": player.ready}


def handle_action(room: Room, player_id: str, data: dict) -> tuple[Room, dict]:
    if room.status != RoomStatus.PLAYING or not room.hand:
        return room, {"type": "error", "message": "No active hand"}

    action_str = data.get("action", "")
    amount = data.get("amount", 0)

    try:
        action = PlayerAction(action_str)
    except ValueError:
        return room, {"type": "error", "message": f"Invalid action: {action_str}"}

    room, event = process_action(room, player_id, action, amount)

    if "error" in event:
        return room, {"type": "error", "message": event["error"]}

    return room, {"type": "event", "event": "action", **event}


def handle_propose_settle(room: Room, player_id: str, data: dict) -> tuple[Room, dict]:
    if not room.hand or room.hand.phase != HandPhase.SHOWDOWN:
        return room, {"type": "error", "message": "Not in showdown"}

    pot_winners = data.get("pot_winners", {})
    if not pot_winners:
        return room, {"type": "error", "message": "No winners specified"}

    room, event = propose_settlement(room, player_id, pot_winners)
    if "error" in event:
        return room, {"type": "error", "message": event["error"]}

    return room, {"type": "event", "event": "settlement_proposed", **event}


def handle_confirm_settle(room: Room, player_id: str) -> tuple[Room, dict]:
    room, event = confirm_settlement(room, player_id)
    if "error" in event:
        return room, {"type": "error", "message": event["error"]}
    if event.get("waiting"):
        return room, {"type": "event", "event": "settlement_confirmed", **event}
    # All confirmed -> settled
    return room, {"type": "event", "event": "settled", **event}


def handle_reject_settle(room: Room, player_id: str) -> tuple[Room, dict]:
    room, event = reject_settlement(room, player_id)
    if "error" in event:
        return room, {"type": "error", "message": event["error"]}
    player = room.players[player_id]
    return room, {"type": "event", "event": "settlement_rejected", "rejector_name": player.name, **event}


def handle_rebuy(room: Room, player_id: str) -> tuple[Room, dict]:
    room, event = do_rebuy(room, player_id)
    if "error" in event:
        return room, {"type": "error", "message": event["error"]}
    # Auto-ready after rebuy, skip countdown
    player = room.players[player_id]
    player.ready = True
    seated = get_seated_players(room)
    if len(seated) >= 2 and all(p.ready for p in seated):
        room = start_hand(room)
        event["hand_started"] = True
    return room, {"type": "event", "event": "rebuy", **event}


def handle_cashout(room: Room, player_id: str) -> tuple[Room, dict]:
    room, event = do_cashout(room, player_id)
    if "error" in event:
        return room, {"type": "error", "message": event["error"]}
    # Auto-ready after cashout if no more cashout needed, skip countdown
    player = room.players[player_id]
    if not can_cashout(room, player_id):
        player.ready = True
        seated = get_seated_players(room)
        if len(seated) >= 2 and all(p.ready for p in seated):
            room = start_hand(room)
            event["hand_started"] = True
    return room, {"type": "event", "event": "cashout", **event}


def handle_end_game(room: Room, player_id: str) -> tuple[Room, dict]:
    """Room owner ends the game and gets final standings."""
    if player_id != room.owner_id:
        return room, {"type": "error", "message": "Only room owner can end the game"}
    if room.status == RoomStatus.PLAYING and room.hand and room.hand.phase not in (HandPhase.HAND_START, HandPhase.HAND_END):
        return room, {"type": "error", "message": "Cannot end game during active hand"}

    room, event = end_game(room)
    return room, {"type": "event", "event": "game_ended", **event}
