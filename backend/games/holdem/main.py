from __future__ import annotations
import asyncio
import time
import json
from fastapi import WebSocket, WebSocketDisconnect

from .models import (
    Room,
    PlayerStatus, RoomStatus, HandPhase,
    PlayerAction,
)
from .redis_manager import save_room, get_room
from .game_engine import (
    start_hand, process_action, get_seated_players,
    can_rebuy, do_rebuy, can_cashout, do_cashout,
    propose_settlement, confirm_settlement, reject_settlement,
    end_game, get_final_standings,
)
from .ws_manager import manager
from lobby.locks import RoomLocks


# Per-room locks to serialize state mutations and prevent race conditions
_room_locks = RoomLocks()


def get_room_lock(room_id: str) -> asyncio.Lock:
    return _room_locks[room_id]


def room_to_broadcast(room: Room) -> dict:
    """Convert room to a dict suitable for broadcasting to all clients."""
    data = json.loads(room.model_dump_json())
    message = {"type": "room_state", "room": data}
    if room.status == RoomStatus.FINISHED:
        message['standings'] = get_final_standings(room)
    return message


async def websocket_endpoint(ws: WebSocket, room_id: str, player_id: str):
    room = await get_room(room_id)
    if not room or player_id not in room.players:
        await ws.accept()
        await ws.close(code=4001, reason="Invalid room or player")
        return

    await manager.connect(room_id, player_id, ws)

    try:
        # Mark player connected under lock
        async with get_room_lock(room_id):
            if manager.rooms.get(room_id, {}).get(player_id) is not ws:
                return
            room = await get_room(room_id)
            if room and player_id in room.players:
                room.players[player_id].is_connected = True
                room.last_all_disconnected_at = None
                await save_room(room)
                await manager.broadcast(room_id, room_to_broadcast(room))

        while True:
            data = await ws.receive_json()
            if manager.rooms.get(room_id, {}).get(player_id) is not ws:
                return
            if not isinstance(data, dict):
                continue
            msg_type = data.get("type")

            if msg_type == "ping":
                await manager.send_to_player(room_id, player_id, {
                    "type": "pong",
                    "timestamp": data.get("timestamp", 0),
                })
                continue

            if msg_type == 'refresh':
                async with get_room_lock(room_id):
                    room = await get_room(room_id)
                    if room:
                        await manager.send_to_player(room_id, player_id, room_to_broadcast(room))
                continue

            # Acquire per-room lock to prevent concurrent state mutations
            async with get_room_lock(room_id):
                if manager.rooms.get(room_id, {}).get(player_id) is not ws:
                    return
                # Reload room state inside lock
                room = await get_room(room_id)
                if not room:
                    await ws.send_json({"type": "error", "message": "Room no longer exists"})
                    break
                if room.status == RoomStatus.FINISHED:
                    await ws.send_json({"type": "error", "message": "筹码局已结束，请返回公共房间"})
                    continue

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
                if room.status == RoomStatus.FINISHED:
                    from lobby import api as lobby_api
                    asyncio.create_task(lobby_api.game_changed(room_id))

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
        # A replaced connection must not mark a newer session disconnected.
        if manager.rooms.get(room_id, {}).get(player_id) is not ws:
            return
        manager.disconnect(room_id, player_id)
        async with get_room_lock(room_id):
            if manager.rooms.get(room_id, {}).get(player_id):
                return
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
