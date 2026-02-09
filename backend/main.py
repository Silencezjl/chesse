import orjson
import asyncio
import uuid
import logging
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from models import Player, GamePhase, Role
from game import GameManager, Room
from state_store import StateStore

logger = logging.getLogger(__name__)

app = FastAPI(title="奶酪大盗 - Cheese Thief")

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class PermissiveCORSMiddleware(BaseHTTPMiddleware):
    """Custom CORS middleware that does NOT block WebSocket connections.

    Starlette's built-in CORSMiddleware checks the Origin header on WebSocket
    handshakes and returns 403 when the origin doesn't match.  Since we serve
    the frontend from the same origin, CORS is irrelevant for WebSocket, so we
    skip the check entirely for ws/wss and only apply standard CORS headers to
    normal HTTP responses.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if not isinstance(response, Response):
            return response
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response


app.add_middleware(PermissiveCORSMiddleware)

game_manager = GameManager()
state_store = StateStore()

# player_id -> WebSocket
connections: dict[str, WebSocket] = {}
# player_id -> room_id (in-memory cache, synced with Redis)
player_rooms: dict[str, str] = {}


async def _save_room_to_redis(room_data: dict):
    """Internal: save room data to Redis."""
    try:
        await state_store.save_room(room_data)
    except Exception as e:
        logger.error(f"Failed to save room to Redis: {e}")


def save_room_to_redis(room: Room):
    """Fire-and-forget: schedule Redis save without blocking the event loop."""
    asyncio.create_task(_save_room_to_redis(room.serialize()))


async def delete_room_from_redis(room_id: str):
    """Delete room from Redis."""
    try:
        await state_store.delete_room(room_id)
        await state_store.remove_players_in_room(room_id)
    except Exception as e:
        logger.error(f"Failed to delete room {room_id} from Redis: {e}")


async def cleanup_stale_rooms_task():
    """Background task to clean up rooms where all players disconnected for 15+ minutes."""
    while True:
        await asyncio.sleep(60)  # check every minute
        stale_ids = game_manager.cleanup_stale_rooms()
        for rid in stale_ids:
            # Clean up player_rooms references
            to_remove = [pid for pid, r_id in player_rooms.items() if r_id == rid]
            for pid in to_remove:
                player_rooms.pop(pid, None)
            await delete_room_from_redis(rid)


async def periodic_save_task():
    """Periodically save all room states to Redis as safety net."""
    while True:
        await asyncio.sleep(30)  # every 30 seconds
        for room in game_manager.rooms.values():
            save_room_to_redis(room)


@app.on_event("startup")
async def startup_event():
    # Connect to Redis
    await state_store.connect()

    # Restore rooms from Redis
    if state_store.available:
        saved_rooms = await state_store.load_all_rooms()
        restored = 0
        for room_data in saved_rooms:
            try:
                room = Room.deserialize(room_data)
                game_manager.rooms[room.id] = room
                # Restore player_rooms mapping
                for pid in room.players:
                    player_rooms[pid] = room.id
                restored += 1
            except Exception as e:
                logger.error(f"Failed to restore room {room_data.get('id')}: {e}")
        if restored:
            logger.info(f"Restored {restored} rooms from Redis")

    asyncio.create_task(cleanup_stale_rooms_task())
    asyncio.create_task(periodic_save_task())


@app.on_event("shutdown")
async def shutdown_event():
    # Save all rooms before shutdown (must await, process is exiting)
    for room in game_manager.rooms.values():
        await _save_room_to_redis(room.serialize())
    await state_store.close()
    logger.info("Saved all rooms and closed Redis connection")


async def send_to_player(player_id: str, message: dict):
    ws = connections.get(player_id)
    if ws:
        try:
            await ws.send_json(message)
        except Exception:
            pass


async def broadcast_to_room(room: Room, message: dict, exclude: str = None):
    tasks = [
        send_to_player(pid, message)
        for pid in room.players if pid != exclude
    ]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def send_room_state(room: Room):
    tasks = []
    for pid in room.players:
        state = room.get_room_state(for_player_id=pid)
        tasks.append(send_to_player(pid, {"type": "room_state", "data": state}))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    # Fire-and-forget Redis save (non-blocking)
    save_room_to_redis(room)


async def handle_create_room(ws: WebSocket, player_id: str, data: dict):
    # Check if player is already in a room
    existing_room = game_manager.find_player_room(player_id)
    if existing_room:
        await ws.send_json({"type": "error", "data": {"message": "你已经在一个房间中"}})
        return

    name = data.get("name", "")
    avatar = data.get("avatar", "")
    player = Player(player_id, name, avatar)
    room = game_manager.create_room(player)
    player_rooms[player_id] = room.id
    await state_store.set_player_room(player_id, room.id)

    # Room settings
    if "thief_see_all_dice" in data:
        room.thief_see_all_dice = bool(data["thief_see_all_dice"])
    if "max_dice" in data:
        val = int(data["max_dice"])
        if 6 <= val <= 10:
            room.max_dice = val
    # Outsider settings
    if "outsider_ratatouille" in data:
        room.outsider_ratatouille = bool(data["outsider_ratatouille"])
    if "outsider_trickster" in data:
        room.outsider_trickster = bool(data["outsider_trickster"])
    if "outsider_drunk" in data:
        room.outsider_drunk = bool(data["outsider_drunk"])

    await ws.send_json({
        "type": "room_created",
        "data": {"room_id": room.id}
    })
    await send_room_state(room)


async def handle_join_room(ws: WebSocket, player_id: str, data: dict):
    room_id = data.get("room_id", "").strip()
    if not room_id:
        await ws.send_json({"type": "error", "data": {"message": "请输入房间号"}})
        return

    room = game_manager.get_room(room_id)
    if not room:
        await ws.send_json({"type": "error", "data": {"message": "房间不存在"}})
        return

    if player_id in room.players:
        # Reconnection
        room.players[player_id].connected = True
        player_rooms[player_id] = room.id
        await state_store.set_player_room(player_id, room.id)
        await send_room_state(room)
        return

    if room.phase != GamePhase.WAITING:
        await ws.send_json({"type": "error", "data": {"message": "游戏已经开始，无法加入"}})
        return

    if len(room.players) >= room.max_players:
        await ws.send_json({"type": "error", "data": {"message": "房间已满"}})
        return

    name = data.get("name", "")
    avatar = data.get("avatar", "")
    player = Player(player_id, name, avatar)
    room.add_player(player)
    player_rooms[player_id] = room.id
    await state_store.set_player_room(player_id, room.id)

    await broadcast_to_room(room, {
        "type": "player_joined",
        "data": {"player_id": player_id, "name": player.name, "avatar": player.avatar}
    }, exclude=player_id)
    await send_room_state(room)


async def handle_ready(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room:
        return

    ready = data.get("ready", True)
    room.set_ready(player_id, ready)

    await send_room_state(room)

    # Check if all ready -> start game
    if room.all_ready():
        await asyncio.sleep(1)
        room.start_game()
        # Send personalized night info from precomputed night_info (stripped of internal flags)
        for pid in room.players:
            night_data = room.get_player_night_info(pid)
            await send_to_player(pid, {"type": "game_start", "data": night_data})

        await send_room_state(room)
        # Auto-check if all night actions already done (e.g. all mice are in groups)
        await check_night_complete(room)


async def handle_peek(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.NIGHT:
        return

    target_id = data.get("target_id")
    if not target_id:
        return

    result = room.peek_dice(player_id, target_id)
    if result is not None:
        target = room.players[target_id]
        await ws.send_json({
            "type": "peek_result",
            "data": {
                "target_id": target_id,
                "target_name": target.name,
                "dice": result
            }
        })
        # Mark as done and check
        room.mark_night_done(player_id)
        await send_room_state(room)
        await check_night_complete(room)


async def handle_choose_accomplice(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.NIGHT:
        return

    target_id = data.get("target_id")
    if not target_id:
        return

    success = room.choose_accomplice(player_id, target_id)
    if success:
        thief = room.players[player_id]
        accomplice = room.players[target_id]

        await ws.send_json({
            "type": "accomplice_chosen",
            "data": {
                "accomplice_id": target_id,
                "accomplice_name": accomplice.name,
                "message": f"你选择了 {accomplice.name} 作为共犯"
            }
        })

        # Check if thief chose drunk mouse (don't notify drunk mouse as accomplice)
        drunk_id = room.outsider_id if room.outsider_type == "drunk" else None
        if drunk_id and target_id == drunk_id:
            # Don't send you_are_accomplice to drunk mouse (they think they're thief)
            # But if resolution happened (both chose), notify the real accomplice
            if room.accomplice_id and room.accomplice_id != drunk_id:
                real_acc_id = room.accomplice_id
                await send_to_player(real_acc_id, {
                    "type": "you_are_accomplice",
                    "data": {
                        "thief_id": player_id,
                        "thief_name": thief.name,
                        "thief_dice": thief.display_dice,
                        "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。\n（你是被🍺酒鬼鼠间接选中的）"
                    }
                })
        else:
            await send_to_player(target_id, {
                "type": "you_are_accomplice",
                "data": {
                    "thief_id": player_id,
                    "thief_name": thief.name,
                    "thief_dice": thief.display_dice,
                    "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。"
                }
            })

        await send_room_state(room)
    else:
        await ws.send_json({"type": "error", "data": {"message": "无法选择该玩家作为共犯"}})


async def handle_drunk_choose_accomplice(ws: WebSocket, player_id: str, data: dict):
    """Handle drunk mouse choosing their fake accomplice."""
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.NIGHT:
        return

    target_id = data.get("target_id")
    if not target_id:
        return

    success = room.drunk_choose_accomplice(player_id, target_id)
    if success:
        accomplice = room.players[target_id]

        # Tell drunk mouse their choice was made (they think they're thief)
        await ws.send_json({
            "type": "accomplice_chosen",
            "data": {
                "accomplice_id": target_id,
                "accomplice_name": accomplice.name,
                "message": f"你选择了 {accomplice.name} 作为共犯"
            }
        })

        # If resolution happened (thief chose drunk mouse + drunk mouse chose target),
        # notify the real accomplice
        if room.accomplice_id and room.accomplice_id == target_id:
            thief = room.players[room.thief_id]
            await send_to_player(target_id, {
                "type": "you_are_accomplice",
                "data": {
                    "thief_id": room.thief_id,
                    "thief_name": thief.name,
                    "thief_dice": thief.display_dice,
                    "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。\n（你是被🍺酒鬼鼠间接选中的）"
                }
            })

        await send_room_state(room)
    else:
        await ws.send_json({"type": "error", "data": {"message": "无法选择该玩家作为共犯"}})


async def handle_night_done(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.NIGHT:
        return

    # Check if player can end night (own actions done + thief chose accomplice)
    if not room.can_end_night(player_id):
        await ws.send_json({"type": "error", "data": {"message": "请先完成你的夜晚操作！"}})
        return

    room.mark_night_done(player_id)
    await ws.send_json({"type": "night_done_ack", "data": {"message": "你已结束夜晚行动"}})
    await send_room_state(room)
    await check_night_complete(room)


async def check_night_complete(room: Room):
    if room.all_night_actions_done():
        room.start_day()
        await broadcast_to_room(room, {
            "type": "day_start",
            "data": {"message": "天亮了！大家开始讨论吧。", "discussion_seconds": room.discussion_seconds}
        })
        await send_room_state(room)


async def handle_request_vote(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.DAY:
        return

    room.add_vote_request(player_id)
    player = room.players[player_id]
    await broadcast_to_room(room, {
        "type": "vote_requested",
        "data": {
            "player_id": player_id,
            "name": player.name,
            "request_count": room.vote_request_count(),
            "required": room.vote_request_required(),
        }
    })
    await send_room_state(room)

    # Check if majority reached
    if room.vote_request_count() >= room.vote_request_required():
        room.start_voting()
        await broadcast_to_room(room, {
            "type": "vote_start",
            "data": {"message": "超过半数玩家发起投票，投票开始！"}
        })
        await send_room_state(room)


async def handle_vote(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.VOTING:
        return

    target_id = data.get("target_id")
    if not target_id:
        return

    success, err_msg = room.cast_vote(player_id, target_id)
    if success:
        await send_room_state(room)

        if room.all_voted():
            result = room.tally_votes()
            await broadcast_to_room(room, {
                "type": "game_result",
                "data": result
            })
            await send_room_state(room)
    else:
        await ws.send_json({"type": "error", "data": {"message": err_msg}})


async def handle_new_game(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room:
        return

    if room.creator_id != player_id:
        await ws.send_json({"type": "error", "data": {"message": "只有房主可以开启下一局"}})
        return

    room.reset_for_new_game()
    await broadcast_to_room(room, {
        "type": "new_game",
        "data": {"message": "新一局游戏即将开始，请准备！"}
    })
    await send_room_state(room)


async def handle_leave_room(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room:
        return

    # Prevent leaving during active game
    if room.phase in (GamePhase.NIGHT, GamePhase.DAY, GamePhase.VOTING):
        await ws.send_json({"type": "error", "data": {"message": "游戏进行中无法退出房间"}})
        return

    should_delete = room.remove_player(player_id)
    player_rooms.pop(player_id, None)
    await state_store.remove_player_room(player_id)

    if should_delete:
        game_manager.remove_room(room.id)
        await delete_room_from_redis(room.id)
    else:
        await send_room_state(room)

    await ws.send_json({"type": "left_room", "data": {}})


async def handle_get_game_info(ws: WebSocket, player_id: str, data: dict):
    """Handle explicit request for current game info (Bug3: refresh recovery)."""
    room = game_manager.find_player_room(player_id)
    if not room:
        await ws.send_json({"type": "no_room", "data": {}})
        return
    # Send full room state which now includes my_info
    state = room.get_room_state(for_player_id=player_id)
    await ws.send_json({"type": "room_state", "data": state})


async def handle_list_rooms(ws: WebSocket, player_id: str, data: dict):
    """Return list of joinable rooms."""
    rooms = game_manager.list_rooms()
    await ws.send_json({"type": "room_list", "data": {"rooms": rooms}})


async def handle_rejoin_room(ws: WebSocket, player_id: str, data: dict):
    """Try to rejoin a room by saved room_id. Used when client reloads with saved state."""
    room_id = data.get("room_id", "").strip()
    if not room_id:
        await ws.send_json({"type": "no_room", "data": {}})
        return

    room = game_manager.get_room(room_id)
    if not room or player_id not in room.players:
        # Room gone or player not in it
        await ws.send_json({"type": "left_room", "data": {}})
        return

    # Reconnect the player
    room.players[player_id].connected = True
    room.update_disconnect_timer()
    player_rooms[player_id] = room.id
    await state_store.set_player_room(player_id, room.id)

    # Send full room state
    await send_room_state(room)

    # Notify others
    await broadcast_to_room(room, {
        "type": "player_reconnected",
        "data": {"player_id": player_id, "name": room.players[player_id].name}
    }, exclude=player_id)

    # Check if all votes are now in
    if room.phase == GamePhase.VOTING and room.all_voted():
        result = room.tally_votes()
        await broadcast_to_room(room, {
            "type": "game_result",
            "data": result
        })
        await send_room_state(room)


async def handle_update_room_settings(ws: WebSocket, player_id: str, data: dict):
    """Allow the room creator to update room settings during WAITING phase."""
    room = game_manager.find_player_room(player_id)
    if not room:
        return

    if room.creator_id != player_id:
        await ws.send_json({"type": "error", "data": {"message": "只有房主可以修改房间设置"}})
        return

    if room.phase != GamePhase.WAITING:
        await ws.send_json({"type": "error", "data": {"message": "游戏进行中无法修改设置"}})
        return

    if "thief_see_all_dice" in data:
        room.thief_see_all_dice = bool(data["thief_see_all_dice"])
    if "max_dice" in data:
        val = int(data["max_dice"])
        if 6 <= val <= 10:
            room.max_dice = val
    if "outsider_ratatouille" in data:
        room.outsider_ratatouille = bool(data["outsider_ratatouille"])
    if "outsider_trickster" in data:
        room.outsider_trickster = bool(data["outsider_trickster"])
    if "outsider_drunk" in data:
        room.outsider_drunk = bool(data["outsider_drunk"])

    await send_room_state(room)


MESSAGE_HANDLERS = {
    "create_room": handle_create_room,
    "join_room": handle_join_room,
    "rejoin_room": handle_rejoin_room,
    "ready": handle_ready,
    "peek": handle_peek,
    "choose_accomplice": handle_choose_accomplice,
    "drunk_choose_accomplice": handle_drunk_choose_accomplice,
    "night_done": handle_night_done,
    "request_vote": handle_request_vote,
    "vote": handle_vote,
    "new_game": handle_new_game,
    "update_room_settings": handle_update_room_settings,
    "leave_room": handle_leave_room,
    "get_game_info": handle_get_game_info,
    "list_rooms": handle_list_rooms,
}


@app.websocket("/ws/{player_id}")
async def websocket_endpoint(websocket: WebSocket, player_id: str):
    await websocket.accept()
    connections[player_id] = websocket

    # Check for reconnection
    room_id = player_rooms.get(player_id)
    if room_id:
        room = game_manager.get_room(room_id)
        if room and player_id in room.players:
            room.players[player_id].connected = True
            room.update_disconnect_timer()
            await send_room_state(room)
            await broadcast_to_room(room, {
                "type": "player_reconnected",
                "data": {"player_id": player_id, "name": room.players[player_id].name}
            }, exclude=player_id)

            # After reconnection, check if all votes are now in
            if room.phase == GamePhase.VOTING and room.all_voted():
                result = room.tally_votes()
                await broadcast_to_room(room, {
                    "type": "game_result",
                    "data": result
                })
                await send_room_state(room)

    # Tell client their player_id and whether they have an active room
    connected_data = {"player_id": player_id}
    if room_id:
        connected_data["room_id"] = room_id
    await websocket.send_json({"type": "connected", "data": connected_data})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = orjson.loads(raw)
            except (orjson.JSONDecodeError, ValueError):
                continue

            msg_type = msg.get("type")
            msg_data = msg.get("data", {})

            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "data": {}})
                continue

            handler = MESSAGE_HANDLERS.get(msg_type)
            if handler:
                await handler(websocket, player_id, msg_data)
            else:
                await websocket.send_json({"type": "error", "data": {"message": f"未知消息类型: {msg_type}"}})

    except WebSocketDisconnect:
        connections.pop(player_id, None)
        room = game_manager.find_player_room(player_id)
        if room and player_id in room.players:
            room.players[player_id].connected = False
            room.update_disconnect_timer()
            await broadcast_to_room(room, {
                "type": "player_disconnected",
                "data": {"player_id": player_id, "name": room.players[player_id].name}
            })
            await send_room_state(room)
            # Extra save on disconnect to persist the disconnected state
            save_room_to_redis(room)


# Serve frontend static files
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = os.path.join(frontend_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(
            os.path.join(frontend_dir, "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"},
        )
