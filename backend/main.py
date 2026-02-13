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
    asyncio.create_task(_save_room_to_redis(room.serialize()))


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
        # Remove rooms where no one is online
        empty_ids = [rid for rid, room in game_manager.rooms.items() if room.all_offline()]
        for rid in empty_ids:
            room = game_manager.rooms.get(rid)
            if room:
                for pid in list(room.players) + list(room.spectators):
                    player_rooms.pop(pid, None)
                    await state_store.remove_player_room(pid)
            game_manager.remove_room(rid)
            await delete_room_from_redis(rid)
        # Also remove rooms disconnected for 15+ minutes (safety net)
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
    if "outsider_drunk" in data:
        room.outsider_drunk = bool(data["outsider_drunk"])
    if "outsider_dodobird" in data:
        room.outsider_dodobird = bool(data["outsider_dodobird"])
    if "outsider_tom_jerry" in data:
        room.outsider_tom_jerry = bool(data["outsider_tom_jerry"])
    # Hex skill settings
    if "hex_time_warp" in data:
        room.hex_time_warp = bool(data["hex_time_warp"])
    if "hex_perception_interference" in data:
        room.hex_perception_interference = bool(data["hex_perception_interference"])
    if "hex_retirement_account" in data:
        room.hex_retirement_account = bool(data["hex_retirement_account"])
    if "hex_lethal_tempo" in data:
        room.hex_lethal_tempo = bool(data["hex_lethal_tempo"])
    if "hex_handpicked" in data:
        room.hex_handpicked = bool(data["hex_handpicked"])

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


async def _try_notify_accomplices(room: Room):
    """Send accomplice notifications after both thief and dodobird have chosen.
    If dodobird is not in play, send immediately.
    If both have chosen:
      - Same target: target is real accomplice, sees real thief
      - Different targets: real accomplice sees real thief, fake accomplice sees dodobird as 'thief'
    """
    thief = room.players[room.thief_id]

    # Drunk mouse special case: thief chose drunk mouse
    drunk_id = room.outsider_id if room.outsider_type == "drunk" else None
    if drunk_id and room.thief_raw_accomplice_id == drunk_id:
        # Don't send to drunk mouse; wait for resolution
        if room.accomplice_id and room.accomplice_id != drunk_id:
            real_acc_id = room.accomplice_id
            await send_to_player(real_acc_id, {
                "type": "you_are_accomplice",
                "data": {
                    "thief_id": room.thief_id,
                    "thief_name": thief.name,
                    "thief_dice": thief.display_dice,
                    "message": f"奶酪大盗 {thief.name} 选择你作为共犯！你们同赢同输。\n（你是被🍺酒鬼鼠间接选中的）"
                }
            })
        return

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


async def _try_send_delayed_hex(room: Room):
    """If a delayed hex skill was just finalized, send hex info to the assigned player."""
    hex_pid = room.hex_target_id
    if not hex_pid:
        return
    # Only send if the player has a hex_skill and it's one of the delayed types
    player = room.players.get(hex_pid)
    if not player or player.hex_skill not in ("retirement_account", "handpicked"):
        return
    # Check if night_info already has hex_skill_info (set by _finalize_delayed_hex_skill)
    night = room.night_info.get(hex_pid, {})
    if not night.get("hex_skill_info"):
        return
    # Send game_info update to the hex holder
    await send_to_player(hex_pid, {
        "type": "game_info",
        "data": night
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
        # Check for delayed hex skill finalization
        await _try_send_delayed_hex(room)
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
        # Check for delayed hex skill finalization
        await _try_send_delayed_hex(room)
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
    if room.all_night_actions_done():
        room.start_day()
        # Track day start time for lethal_tempo
        import time as _time
        room.day_start_time = _time.time()
        day_data = {"message": "天亮了！大家开始讨论吧。", "discussion_seconds": room.discussion_seconds}
        # If lethal_tempo is active, include threshold info
        if room.hex_type == "lethal_tempo":
            day_data["lethal_tempo_threshold"] = len(room.players)
            day_data["day_start_time"] = room.day_start_time
        await broadcast_to_room(room, {
            "type": "day_start",
            "data": day_data
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
            if result.get("phase") == "assassinate":
                # Enter ASSASSINATE phase - Tom gets 30s to guess Jerry
                await broadcast_to_room(room, {
                    "type": "assassinate_phase",
                    "data": result
                })
                await send_room_state(room)
                # Start 30s timer
                asyncio.create_task(_assassinate_timer(room))
            else:
                await broadcast_to_room(room, {
                    "type": "game_result",
                    "data": result
                })
                await send_room_state(room)
    else:
        await ws.send_json({"type": "error", "data": {"message": err_msg}})


async def _assassinate_timer(room: Room):
    """30-second timer for ASSASSINATE phase. If Tom doesn't act, mice win."""
    await asyncio.sleep(30)
    if room.phase != GamePhase.ASSASSINATE:
        return  # Already resolved
    # Timeout: finalize as mouse win
    result = room.finalize_assassinate()
    await broadcast_to_room(room, {
        "type": "game_result",
        "data": result
    })
    await send_room_state(room)


async def handle_assassinate(ws: WebSocket, player_id: str, data: dict):
    """Handle Tom's assassination attempt."""
    room = game_manager.find_player_room(player_id)
    if not room:
        return

    target_id = data.get("target_id")
    if not target_id:
        return

    result = room.tom_assassinate(player_id, target_id)
    if not result.get("success"):
        await ws.send_json({"type": "error", "data": {"message": result.get("error", "刺杀失败")}})
        return

    if result.get("correct"):
        # Jerry found! Thief wins immediately regardless of phase
        if room.phase == GamePhase.ASSASSINATE:
            final = room.finalize_assassinate(result)
        else:
            # Assassination during non-ASSASSINATE phase -> instant game over
            room.phase = GamePhase.RESULT
            final = {
                "winner": "thief",
                "assassinate_result": "success",
                "assassinate_target_id": target_id,
                "tom_id": room.tom_id,
                "tom_name": room.players[room.tom_id].name,
                "jerry_id": room.jerry_id,
                "jerry_name": room.players[room.jerry_id].name,
                "thief_id": room.thief_id,
                "thief_name": room.players[room.thief_id].name,
                "accomplice_id": room.accomplice_id,
                "accomplice_name": room.players[room.accomplice_id].name if room.accomplice_id else None,
                "players": {pid: p.to_dict(reveal=True) for pid, p in room.players.items()},
                "action_log": room.build_action_log(),
            }
        await broadcast_to_room(room, {"type": "game_result", "data": final})
        await send_room_state(room)
    else:
        # Wrong guess
        if room.phase == GamePhase.ASSASSINATE:
            # In ASSASSINATE phase, wrong guess = mice win
            final = room.finalize_assassinate(result)
            await broadcast_to_room(room, {"type": "game_result", "data": final})
            await send_room_state(room)
        else:
            # During other phases, assassination wasted - game continues
            await ws.send_json({
                "type": "assassinate_failed",
                "data": {
                    "message": "刺杀失败！你选错了人，刺杀技能已用尽。",
                    "target_id": target_id,
                    "jerry_id": result.get("jerry_id"),
                }
            })
            await send_room_state(room)


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
        if result.get("phase") == "assassinate":
            await broadcast_to_room(room, {"type": "assassinate_phase", "data": result})
            await send_room_state(room)
            asyncio.create_task(_assassinate_timer(room))
        else:
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
    if "outsider_drunk" in data:
        room.outsider_drunk = bool(data["outsider_drunk"])
    if "outsider_dodobird" in data:
        room.outsider_dodobird = bool(data["outsider_dodobird"])
    if "outsider_tom_jerry" in data:
        room.outsider_tom_jerry = bool(data["outsider_tom_jerry"])
    if "hex_time_warp" in data:
        room.hex_time_warp = bool(data["hex_time_warp"])
    if "hex_perception_interference" in data:
        room.hex_perception_interference = bool(data["hex_perception_interference"])
    if "hex_retirement_account" in data:
        room.hex_retirement_account = bool(data["hex_retirement_account"])
    if "hex_lethal_tempo" in data:
        room.hex_lethal_tempo = bool(data["hex_lethal_tempo"])
    if "hex_handpicked" in data:
        room.hex_handpicked = bool(data["hex_handpicked"])

    await send_room_state(room)


async def handle_handpicked_choose(ws: WebSocket, player_id: str, data: dict):
    """精心挑选: hex holder chooses which player to boost during voting."""
    room = game_manager.find_player_room(player_id)
    if not room or room.phase != GamePhase.VOTING:
        return
    if room.hex_type != "handpicked" or room.hex_target_id != player_id:
        await ws.send_json({"type": "error", "data": {"message": "你没有精心挑选技能"}})
        return
    target_id = data.get("target_id")
    if not target_id or target_id not in room.players or target_id == player_id:
        await ws.send_json({"type": "error", "data": {"message": "无效的目标"}})
        return
    room.handpicked_boost_target_id = target_id
    target = room.players[target_id]
    await ws.send_json({
        "type": "handpicked_chosen",
        "data": {"target_id": target_id, "target_name": target.name, "message": f"你选择了 {target.name}，TA的投票对象将获得+2票"}
    })
    await send_room_state(room)


MESSAGE_HANDLERS = {
    "create_room": handle_create_room,
    "join_room": handle_join_room,
    "rejoin_room": handle_rejoin_room,
    "ready": handle_ready,
    "peek": handle_peek,
    "choose_accomplice": handle_choose_accomplice,
    "drunk_choose_accomplice": handle_drunk_choose_accomplice,
    "dodobird_choose_accomplice": handle_dodobird_choose_accomplice,
    "night_done": handle_night_done,
    "request_vote": handle_request_vote,
    "vote": handle_vote,
    "handpicked_choose": handle_handpicked_choose,
    "assassinate": handle_assassinate,
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
                if result.get("phase") == "assassinate":
                    await broadcast_to_room(room, {"type": "assassinate_phase", "data": result})
                    await send_room_state(room)
                    asyncio.create_task(_assassinate_timer(room))
                else:
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

            # If no one is online, close the room immediately
            if room.all_offline():
                for pid in list(room.players) + list(room.spectators):
                    player_rooms.pop(pid, None)
                    await state_store.remove_player_room(pid)
                game_manager.remove_room(room.id)
                await delete_room_from_redis(room.id)
            else:
                await send_room_state(room)
                save_room_to_redis(room)


