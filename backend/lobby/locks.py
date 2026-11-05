"""Per-key locks retained while held or awaited."""
import asyncio
import weakref


class RoomLocks(weakref.WeakValueDictionary):
    def __getitem__(self, key):
        try:
            return super().__getitem__(key)
        except KeyError:
            lock = asyncio.Lock()
            self[key] = lock
            return lock
