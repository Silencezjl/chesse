"""
Redis State Store for Cheese Thief game.

Game industry pattern: in-memory hot state + Redis persistent snapshots.
- Active game logic runs on in-memory Python objects (zero latency)
- Redis stores serialized snapshots on key events (crash recovery)
- Player session mapping (player_id -> room_id) persisted in Redis
- On server restart, all rooms and sessions are restored from Redis
"""

import orjson
import os
import logging
from typing import Optional

import redis.asyncio as redis
from redis.asyncio.connection import ConnectionPool

logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Redis key prefixes
ROOM_KEY_PREFIX = "cheese:room:"
PLAYER_ROOM_KEY = "cheese:player_rooms"
ROOMS_INDEX_KEY = "cheese:rooms"


class StateStore:
    """Async Redis state store for game state persistence."""

    def __init__(self):
        self._redis: Optional[redis.Redis] = None

    async def connect(self):
        """Connect to Redis with optimized connection pool."""
        try:
            pool = ConnectionPool.from_url(
                REDIS_URL,
                decode_responses=True,
                max_connections=50,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True,
            )
            self._redis = redis.Redis(connection_pool=pool)
            await self._redis.ping()
            logger.info(f"Connected to Redis at {REDIS_URL} (pool=50)")
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}. Running without persistence.")
            self._redis = None

    async def close(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()

    @property
    def available(self) -> bool:
        return self._redis is not None

    # ---- Room State ----

    async def save_room(self, room_data: dict):
        """Save serialized room state to Redis."""
        if not self._redis:
            return
        room_id = room_data["id"]
        try:
            pipe = self._redis.pipeline()
            pipe.set(f"{ROOM_KEY_PREFIX}{room_id}", orjson.dumps(room_data).decode())
            pipe.sadd(ROOMS_INDEX_KEY, room_id)
            await pipe.execute()
        except Exception as e:
            logger.error(f"Failed to save room {room_id}: {e}")

    async def load_room(self, room_id: str) -> Optional[dict]:
        """Load serialized room state from Redis."""
        if not self._redis:
            return None
        try:
            data = await self._redis.get(f"{ROOM_KEY_PREFIX}{room_id}")
            return orjson.loads(data) if data else None
        except Exception as e:
            logger.error(f"Failed to load room {room_id}: {e}")
            return None

    async def delete_room(self, room_id: str):
        """Remove room from Redis."""
        if not self._redis:
            return
        try:
            pipe = self._redis.pipeline()
            pipe.delete(f"{ROOM_KEY_PREFIX}{room_id}")
            pipe.srem(ROOMS_INDEX_KEY, room_id)
            await pipe.execute()
        except Exception as e:
            logger.error(f"Failed to delete room {room_id}: {e}")

    async def load_all_rooms(self) -> list[dict]:
        """Load all room states from Redis."""
        if not self._redis:
            return []
        try:
            room_ids = await self._redis.smembers(ROOMS_INDEX_KEY)
            rooms = []
            if room_ids:
                pipe = self._redis.pipeline()
                for rid in room_ids:
                    pipe.get(f"{ROOM_KEY_PREFIX}{rid}")
                results = await pipe.execute()
                for data in results:
                    if data:
                        rooms.append(orjson.loads(data))
            return rooms
        except Exception as e:
            logger.error(f"Failed to load all rooms: {e}")
            return []

    # ---- Player Session ----

    async def set_player_room(self, player_id: str, room_id: str):
        """Map player to room in Redis."""
        if not self._redis:
            return
        try:
            await self._redis.hset(PLAYER_ROOM_KEY, player_id, room_id)
        except Exception as e:
            logger.error(f"Failed to set player room: {e}")

    async def get_player_room(self, player_id: str) -> Optional[str]:
        """Get room_id for a player from Redis."""
        if not self._redis:
            return None
        try:
            return await self._redis.hget(PLAYER_ROOM_KEY, player_id)
        except Exception as e:
            logger.error(f"Failed to get player room: {e}")
            return None

    async def remove_player_room(self, player_id: str):
        """Remove player-room mapping from Redis."""
        if not self._redis:
            return
        try:
            await self._redis.hdel(PLAYER_ROOM_KEY, player_id)
        except Exception as e:
            logger.error(f"Failed to remove player room: {e}")

    async def get_all_player_rooms(self) -> dict[str, str]:
        """Get all player-room mappings from Redis."""
        if not self._redis:
            return {}
        try:
            return await self._redis.hgetall(PLAYER_ROOM_KEY) or {}
        except Exception as e:
            logger.error(f"Failed to get all player rooms: {e}")
            return {}

    async def remove_players_in_room(self, room_id: str):
        """Remove all player-room mappings for a given room."""
        if not self._redis:
            return
        try:
            all_mappings = await self._redis.hgetall(PLAYER_ROOM_KEY)
            if all_mappings:
                to_remove = [pid for pid, rid in all_mappings.items() if rid == room_id]
                if to_remove:
                    await self._redis.hdel(PLAYER_ROOM_KEY, *to_remove)
        except Exception as e:
            logger.error(f"Failed to remove players in room {room_id}: {e}")
