import orjson
import asyncio
import uuid
import logging
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from models import Player, GamePhase, Role
from game import GameManager, Room
from state_store import StateStore

logger = logging.getLogger(__name__)

app = FastAPI(title="奶酪大盗 - Cheese Thief")

from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    async def save_current():
        if game_manager.rooms.get(room.id) is room:
            await _save_room_to_redis(room.serialize())
    asyncio.create_task(save_current())


async def delete_room_from_redis(room_id: str):
    """Delete room from Redis."""
    try:
        await state_store.delete_room(room_id)
        await state_store.remove_players_in_room(room_id)
    except Exception as e:
        logger.error(f"Failed to delete room {room_id} from Redis: {e}")


async def cleanup_stale_rooms_task():
    """Background task to clean up empty/stale rooms every 10 seconds."""
    while True:
        await asyncio.sleep(10)
        # Allow a disconnected room 15 minutes to reconnect.
        stale_ids = game_manager.cleanup_stale_rooms()
        for rid in stale_ids:
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
    from lobby import api as lobby_api
    lobby_api.configure(state_store._redis, game_manager, state_store, connections, player_rooms)
    await lobby_api.reset_presence()

    # Restore rooms from Redis
    if state_store.available:
        saved_rooms = await state_store.load_all_rooms()
        restored = 0
        for room_data in saved_rooms:
            try:
                room = Room.deserialize(room_data)
                room.update_disconnect_timer()
                game_manager.rooms[room.id] = room
                # Restore player_rooms mapping
                for pid in list(room.players) + list(room.spectators):
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
    from games.holdem.redis_manager import close_redis
    await close_redis()
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
        for pid in list(room.players) + list(room.spectators) if pid != exclude
    ]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def send_room_state(room: Room):
    tasks = []
    for pid in room.players:
        state = room.get_room_state(for_player_id=pid)
        tasks.append(send_to_player(pid, {"type": "room_state", "data": state}))
    for sid in room.spectators:
        state = room.get_room_state(for_player_id=sid)
        tasks.append(send_to_player(sid, {"type": "room_state", "data": state}))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    # Fire-and-forget Redis save (non-blocking)
    save_room_to_redis(room)
    if room.phase == GamePhase.RESULT:
        from lobby import api as lobby_api
        if lobby_api.redis is not None:
            asyncio.create_task(lobby_api.game_changed(room.id))


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
    if "outsider_dodobird" in data:
        room.outsider_dodobird = bool(data["outsider_dodobird"])

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
        # Reconnection (active player)
        room.players[player_id].connected = True
        player_rooms[player_id] = room.id
        await state_store.set_player_room(player_id, room.id)
        await send_room_state(room)
        return

    if player_id in room.spectators:
        # Reconnection (spectator)
        room.spectators[player_id].connected = True
        player_rooms[player_id] = room.id
        await state_store.set_player_room(player_id, room.id)
        await send_room_state(room)
        return

    name = data.get("name", "")
    avatar = data.get("avatar", "")
    player = Player(player_id, name, avatar)

    if room.phase != GamePhase.WAITING:
        # Game in progress: join as spectator
        room.add_spectator(player)
        player_rooms[player_id] = room.id
        await state_store.set_player_room(player_id, room.id)
        await broadcast_to_room(room, {
            "type": "player_joined",
            "data": {"player_id": player_id, "name": player.name, "avatar": player.avatar, "is_spectator": True}
        }, exclude=player_id)
        await send_room_state(room)
        return

    if len(room.players) >= room.max_players:
        await ws.send_json({"type": "error", "data": {"message": "房间已满"}})
        return

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
    if not room or room.phase != GamePhase.WAITING or player_id not in room.players:
        return

    ready = data.get("ready", True)
    room.set_ready(player_id, ready)

    await send_room_state(room)

    # Check if all ready -> start game
    if room.phase == GamePhase.WAITING and room.all_ready() and not room.game_start_pending:
        room.game_start_pending = True
        try:
            await asyncio.sleep(1)
            if room.phase != GamePhase.WAITING or not room.all_ready():
                return
            room.start_game()
            for pid in room.players:
                night_data = room.get_player_night_info(pid)
                await send_to_player(pid, {"type": "game_start", "data": night_data})
            await send_room_state(room)
        finally:
            room.game_start_pending = False


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
        await send_room_state(room)


async def _try_notify_accomplices(room: Room):
    """Send accomplice notifications after both thief and dodobird have chosen.
    If dodobird is not in play, send immediately.
    If both have chosen:
      - Same target: target is real accomplice, sees real thief
      - Different targets: real accomplice sees real thief, fake accomplice sees dodobird as 'thief'
    """
    thief = room.players[room.thief_id]

    # If dodobird is in play, wait for both to choose
    if room.dodobird_id:
        if room.thief_raw_accomplice_id is None or room.dodobird_accomplice_id is None:
            return  # Still waiting for one of them

        real_acc_id = room.accomplice_id
        fake_acc_id = room.dodobird_accomplice_id

        if real_acc_id == fake_acc_id:
            # Same target: real accomplice, sees real thief
            await send_to_player(real_acc_id, {
                "type": "you_are_accomplice",
                "data": {
                    "thief_id": room.thief_id,
                    "thief_name": thief.name,
                    "thief_dice": thief.display_dice,
                    "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。"
                }
            })
        else:
            # Different targets: notify real accomplice with real thief
            if real_acc_id:
                await send_to_player(real_acc_id, {
                    "type": "you_are_accomplice",
                    "data": {
                        "thief_id": room.thief_id,
                        "thief_name": thief.name,
                        "thief_dice": thief.display_dice,
                        "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。"
                    }
                })
            # Notify fake accomplice: sees dodobird as "thief"
            if fake_acc_id and not room.players[fake_acc_id].is_accomplice:
                dodobird = room.players[room.dodobird_id]
                await send_to_player(fake_acc_id, {
                    "type": "you_are_accomplice",
                    "data": {
                        "thief_id": room.dodobird_id,  # shows dodobird as the "thief"
                        "thief_name": dodobird.name,
                        "thief_dice": dodobird.dice,
                        "message": f"奶酪大盗 {dodobird.name} 选择你作为共犯！你们同赢同输。"
                    }
                })
    else:
        # No dodobird: notify real accomplice immediately
        if room.accomplice_id:
            acc_id = room.accomplice_id
            await send_to_player(acc_id, {
                "type": "you_are_accomplice",
                "data": {
                    "thief_id": room.thief_id,
                    "thief_name": thief.name,
                    "thief_dice": thief.display_dice,
                    "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。"
                }
            })


async def handle_choose_accomplice(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.NIGHT:
        return

    target_id = data.get("target_id")
    if not target_id:
        return

    success = room.choose_accomplice(player_id, target_id)
    if success:
        accomplice = room.players[target_id]

        await ws.send_json({
            "type": "accomplice_chosen",
            "data": {
                "accomplice_id": target_id,
                "accomplice_name": accomplice.name,
                "message": f"你选择了 {accomplice.name} 作为共犯"
            }
        })

        await _try_notify_accomplices(room)
        await send_room_state(room)
    else:
        await ws.send_json({"type": "error", "data": {"message": "无法选择该玩家作为共犯"}})


async def handle_dodobird_choose_accomplice(ws: WebSocket, player_id: str, data: dict):
    """Handle dodobird choosing a fake accomplice."""
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.NIGHT:
        return

    target_id = data.get("target_id")
    if not target_id:
        return

    success = room.dodobird_choose_accomplice(player_id, target_id)
    if success:
        target = room.players[target_id]

        # Tell dodobird their choice was made
        await ws.send_json({
            "type": "accomplice_chosen",
            "data": {
                "accomplice_id": target_id,
                "accomplice_name": target.name,
                "message": f"你选择了 {target.name} 作为假共犯"
            }
        })

        # Defer notification: _try_notify_accomplices checks if both chose
        await _try_notify_accomplices(room)
        await send_room_state(room)
    else:
        await ws.send_json({"type": "error", "data": {"message": "无法选择该玩家作为假共犯"}})


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
    if room.phase == GamePhase.NIGHT and room.all_night_actions_done():
        room.start_day()
        day_data = {"message": "天亮了！大家开始讨论吧。", "discussion_seconds": room.discussion_seconds}
        await broadcast_to_room(room, {
            "type": "day_start",
            "data": day_data
        })
        await send_room_state(room)


async def handle_request_vote(ws: WebSocket, player_id: str, data: dict):
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.DAY or player_id not in room.players:
        return

    room.add_vote_request(player_id)
    player = room.players[player_id]
    start_voting = room.vote_request_count() >= room.vote_request_required()
    if start_voting:
        room.start_voting()
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
    if start_voting:
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

        if room.phase == GamePhase.VOTING and room.all_voted():
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

    if room.phase != GamePhase.RESULT:
        await ws.send_json({"type": "error", "data": {"message": "本局结束后才能开启下一局"}})
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

    is_spectator = player_id in room.spectators

    # Spectators can leave anytime; players can only leave during WAITING
    if not is_spectator and room.phase != GamePhase.WAITING:
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
    if not room or (player_id not in room.players and player_id not in room.spectators):
        # Room gone or player not in it
        await ws.send_json({"type": "left_room", "data": {}})
        return

    # Reconnect the player or spectator
    if player_id in room.players:
        room.players[player_id].connected = True
        p_name = room.players[player_id].name
    else:
        room.spectators[player_id].connected = True
        p_name = room.spectators[player_id].name
    room.update_disconnect_timer()
    player_rooms[player_id] = room.id
    await state_store.set_player_room(player_id, room.id)

    # Send full room state
    await send_room_state(room)

    # Notify others
    await broadcast_to_room(room, {
        "type": "player_reconnected",
        "data": {"player_id": player_id, "name": p_name}
    }, exclude=player_id)

    # Check if all votes are now in
    if room.phase == GamePhase.VOTING and room.all_voted():
        result = room.tally_votes()
        await broadcast_to_room(room, {"type": "game_result", "data": result})
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
    if "outsider_dodobird" in data:
        room.outsider_dodobird = bool(data["outsider_dodobird"])

    await send_room_state(room)


MESSAGE_HANDLERS = {
    "create_room": handle_create_room,
    "join_room": handle_join_room,
    "rejoin_room": handle_rejoin_room,
    "ready": handle_ready,
    "peek": handle_peek,
    "choose_accomplice": handle_choose_accomplice,
    "dodobird_choose_accomplice": handle_dodobird_choose_accomplice,
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
    from lobby import api as lobby_api
    if not lobby_api.redis:
        await websocket.close(code=1013)
        return
    public_id = await lobby_api.db().get(lobby_api.PLAYER_PREFIX + player_id)
    if not public_id:
        await websocket.close(code=4403)
        return
    if public_id in lobby_api.transitions:
        await websocket.close(code=1013)
        return
    try:
        public_room = await lobby_api.load(public_id)
    except Exception:
        await websocket.close(code=4404)
        return
    if (not public_room.data.get('session_id') or public_room.data['game_id'] != 'cheese') or player_id not in public_room.data['members']:
        await websocket.close(code=4403)
        return
    await websocket.accept()
    previous = connections.get(player_id)
    connections[player_id] = websocket
    if previous and previous is not websocket:
        await previous.close(code=4001)

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
                await broadcast_to_room(room, {"type": "game_result", "data": result})
                await send_room_state(room)
        elif room and player_id in room.spectators:
            room.spectators[player_id].connected = True
            room.update_disconnect_timer()
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

            from lobby import api as lobby_api
            if msg_type in {"create_room", "join_room", "leave_room", "new_game", "update_room_settings"}:
                await websocket.send_json({"type": "error", "data": {"message": "请在公共房间管理游戏和成员"}})
                continue

            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "data": {}})
                continue

            handler = MESSAGE_HANDLERS.get(msg_type)
            if handler:
                await handler(websocket, player_id, msg_data)
            else:
                await websocket.send_json({"type": "error", "data": {"message": f"未知消息类型: {msg_type}"}})

    except WebSocketDisconnect:
        if connections.get(player_id) is not websocket:
            return
        connections.pop(player_id, None)
        room = game_manager.find_player_room(player_id)
        if room:
            if player_id in room.players:
                room.players[player_id].connected = False
                room.update_disconnect_timer()
                await broadcast_to_room(room, {
                    "type": "player_disconnected",
                    "data": {"player_id": player_id, "name": room.players[player_id].name}
                })
            elif player_id in room.spectators:
                room.spectators[player_id].connected = False
                room.update_disconnect_timer()

            await send_room_state(room)


from lobby.api import router as lobby_router
app.include_router(lobby_router)
from games.bluff.service import router as bluff_router
app.include_router(bluff_router)


@app.websocket("/holdem-ws/{room_id}/{player_id}")
async def holdem_socket(websocket: WebSocket, room_id: str, player_id: str):
    from lobby import api as lobby_api
    from games.holdem.main import websocket_endpoint as game_socket
    try:
        room = await lobby_api.load(room_id)
    except Exception:
        await websocket.close(code=4404)
        return
    if room_id in lobby_api.transitions or room.data['game_id'] != 'holdem' or player_id not in room.data['members']:
        await websocket.close(code=4403)
        return
    await game_socket(websocket, room_id, player_id)


