import os
import json
import redis.asyncio as redis
from typing import Optional
from .models import Room

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

_pool: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    global _pool
    if _pool is None:
        _pool = redis.from_url(REDIS_URL, decode_responses=True)
    return _pool


async def close_redis():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def _room_key(room_id: str) -> str:
    return f"lobby:game:holdem:room:{room_id}"


def _rooms_list_key() -> str:
    return "lobby:game:holdem:rooms"


async def save_room(room: Room):
    r = await get_redis()
    data = room.model_dump_json()
    pipe = r.pipeline()
    pipe.set(_room_key(room.id), data)
    pipe.sadd(_rooms_list_key(), room.id)
    await pipe.execute()


async def get_room(room_id: str) -> Optional[Room]:
    r = await get_redis()
    data = await r.get(_room_key(room_id))
    if data is None:
        return None
    return Room.model_validate_json(data)


async def delete_room(room_id: str):
    r = await get_redis()
    pipe = r.pipeline()
    pipe.delete(_room_key(room_id))
    pipe.srem(_rooms_list_key(), room_id)
    await pipe.execute()


async def list_room_ids() -> list[str]:
    r = await get_redis()
    return list(await r.smembers(_rooms_list_key()))


async def list_rooms() -> list[Room]:
    ids = await list_room_ids()
    rooms = []
    for rid in ids:
        room = await get_room(rid)
        if room:
            rooms.append(room)
    return rooms

