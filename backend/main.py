import json
import asyncio
import uuid
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from models import Player, GamePhase, Role
from game import GameManager, Room

app = FastAPI(title="奶酪大盗 - Cheese Thief")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

game_manager = GameManager()

# player_id -> WebSocket
connections: dict[str, WebSocket] = {}
# player_id -> room_id (for reconnection)
player_rooms: dict[str, str] = {}


async def send_to_player(player_id: str, message: dict):
    ws = connections.get(player_id)
    if ws:
        try:
            await ws.send_json(message)
        except Exception:
            pass


async def broadcast_to_room(room: Room, message: dict, exclude: str = None):
    for pid in room.players:
        if pid != exclude:
            await send_to_player(pid, message)


async def send_room_state(room: Room):
    for pid in room.players:
        state = room.get_room_state(for_player_id=pid)
        await send_to_player(pid, {"type": "room_state", "data": state})


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

    # Room settings
    if "thief_see_all_dice" in data:
        room.thief_see_all_dice = bool(data["thief_see_all_dice"])

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
        # Send personalized night info from precomputed night_info
        for pid in room.players:
            night_data = room.night_info.get(pid, {})
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

        await send_to_player(target_id, {
            "type": "you_are_accomplice",
            "data": {
                "thief_id": player_id,
                "thief_name": thief.name,
                "thief_dice": thief.dice,
                "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。"
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

    should_delete = room.remove_player(player_id)
    player_rooms.pop(player_id, None)

    if should_delete:
        game_manager.remove_room(room.id)
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


MESSAGE_HANDLERS = {
    "create_room": handle_create_room,
    "join_room": handle_join_room,
    "ready": handle_ready,
    "peek": handle_peek,
    "choose_accomplice": handle_choose_accomplice,
    "night_done": handle_night_done,
    "request_vote": handle_request_vote,
    "vote": handle_vote,
    "new_game": handle_new_game,
    "leave_room": handle_leave_room,
    "get_game_info": handle_get_game_info,
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
            await send_room_state(room)
            await broadcast_to_room(room, {
                "type": "player_reconnected",
                "data": {"player_id": player_id, "name": room.players[player_id].name}
            }, exclude=player_id)

    # Tell client their player_id and whether they have an active room
    connected_data = {"player_id": player_id}
    if room_id:
        connected_data["room_id"] = room_id
    await websocket.send_json({"type": "connected", "data": connected_data})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")
            msg_data = msg.get("data", {})

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
            await broadcast_to_room(room, {
                "type": "player_disconnected",
                "data": {"player_id": player_id, "name": room.players[player_id].name}
            })
            await send_room_state(room)


# Serve frontend static files
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = os.path.join(frontend_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dir, "index.html"))
