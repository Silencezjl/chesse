"""Common room state and transition rules, independent of transport and storage."""
from copy import deepcopy
import hashlib
import hmac
import secrets
import string
import uuid
import time

from .catalog import CATALOG, options_for

from .games import GAMES, GameAdapter


class RoomError(ValueError):
    pass


def new_id() -> str:
    return ''.join(secrets.choice(string.digits) for _ in range(6))


class LobbyRoom:
    def __init__(self, room_id: str, owner_id: str, name: str, avatar: str):
        self.data = {"id": room_id, "owner_id": owner_id,
                     "members": {owner_id: self._member(name, avatar)},
                     "game_id": None, "game_state": None, "created_at": time.time()}
        self.upgrade()

    @staticmethod
    def _member(name: str, avatar: str) -> dict:
        name = name.strip()
        if not name or len(name) > 12 or not avatar or len(avatar) > 16:
            raise RoomError("请填写不超过 12 个字符的昵称和有效头像")
        return {"name": name, "avatar": avatar, "connected": True}

    @classmethod
    def restore(cls, data: dict) -> "LobbyRoom":
        obj = cls.__new__(cls)
        obj.data = deepcopy(data)
        obj.upgrade()
        return obj

    def snapshot(self) -> dict:
        return deepcopy(self.data)

    def set_password(self, password):
        if password and (not 4 <= len(password) <= 20 or any(c.isspace() for c in password)):
            raise RoomError('密码需为 4–20 位非空白字符')
        salt = secrets.token_hex(16)
        self.data['password_hash'] = (salt + ':' + hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()) if password else None

    def check_password(self, password):
        saved = self.data.get('password_hash')
        if not saved:
            return True
        salt, expected = saved.split(':')
        actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
        return hmac.compare_digest(expected, actual)

    def join(self, player_id: str, name: str, avatar: str):
        if player_id in self.data["members"]:
            self.data["members"][player_id]["connected"] = True
            return
        if len(self.data["members"]) >= 12:
            raise RoomError("房间已满")
        if player_id in self.data["banned"]:
            raise RoomError("你已被移出此房间")
        game_id = self.data["game_id"]
        self.data["members"][player_id] = self._member(name, avatar)
        self.data["members"][player_id]["ready"] = False
        limit = CATALOG.get(game_id, {}).get("maximum", 12)
        if self.data['stage'] in ('playing', 'finished'):
            self.data['pending_member_ids'].append(player_id)
        elif self.data['stage'] != 'countdown' and len(self.data["seats"]) < limit:
            self.data["seats"].append(player_id)
            self.invalidate()

    def disconnect(self, player_id: str):
        if player_id in self.data["members"]:
            self.data["members"][player_id]["connected"] = False
            self.data["members"][player_id]["ready"] = False
            if player_id in self.data["seats"]:
                self.cancel_countdown()

    def leave(self, player_id: str):
        if player_id not in self.data["members"]:
            raise RoomError("你不在此房间中")
        if self.data["stage"] == "playing" and player_id not in self.data['pending_member_ids']:
            raise RoomError("请先结束当前游戏")
        if player_id in self.data['pending_member_ids']:
            self.data['pending_member_ids'].remove(player_id)
        del self.data["members"][player_id]
        if player_id in self.data["seats"]:
            self.data["seats"].remove(player_id)
            self.invalidate()
        if player_id == self.data["owner_id"]:
            self.data["owner_id"] = next(iter(self.data["members"]), None)

    def select_game(self, player_id: str, game_id: str, options: dict,
                    registry: dict[str, GameAdapter] = GAMES):
        if player_id != self.data["owner_id"]:
            raise RoomError("只有房主可以选择游戏")
        if game_id not in registry:
            raise RoomError("未知游戏")
        current = self.data["game_id"]
        if current is not None:
            if current not in registry or not registry[current].can_switch(self.data["game_state"]):
                raise RoomError("当前游戏尚未结束")
        try:
            snapshot = registry[game_id].create(self.snapshot(), options)
        except ValueError as exc:
            raise RoomError(str(exc)) from exc
        self.data["game_id"] = game_id
        self.data["game_state"] = snapshot
        self.data["session_id"] = uuid.uuid4().hex

    def upgrade(self):
        d = self.data
        d.setdefault('stage', 'playing' if d.get('game_state') else ('waiting' if d.get('game_id') else 'choosing'))
        previous = d.get('game_state') or {}
        players = previous.get('players', []) if d.get('game_id') != 'holdem' else []
        legacy_seats = [p for p in players if p in d['members']] or list(d['members'])
        d.setdefault('seats', legacy_seats[:CATALOG.get(d.get('game_id'), {}).get('maximum', 12)])
        if 'options' not in d:
            fields = CATALOG.get(d.get('game_id'), {}).get('settings', [])
            saved = {f['key']: previous[f['key']] for f in fields if f['key'] in previous}
            d['options'] = options_for(d['game_id'], saved) if fields else {}
        d.setdefault('revision', 0)
        d.setdefault('countdown', None)
        d.setdefault('banned', [])
        d.setdefault('password_hash', None)
        d.setdefault('created_at', 0)
        d.setdefault('pending_member_ids', [])
        d.setdefault('empty_since', None)
        d.setdefault('owner_offline_since', None)
        d.setdefault('start_error', '')
        for member in d['members'].values():
            member.setdefault('ready', False)

    def cancel_countdown(self):
        self.data['countdown'] = None
        if self.data['stage'] == 'countdown':
            self.data['stage'] = 'waiting'

    def invalidate(self):
        self.cancel_countdown()
        self.data['revision'] += 1
        self.data['start_error'] = ''
        for member in self.data['members'].values():
            member['ready'] = False

    def editable(self):
        if self.data['stage'] not in ('choosing', 'waiting', 'countdown'):
            raise RoomError('请先返回等待室')

    def configure_game(self, player_id, game_id, options):
        if player_id != self.data['owner_id']:
            raise RoomError('只有房主可以设置游戏')
        self.editable()
        validated = options_for(game_id, options)
        self.data.update(game_id=game_id, options=validated, stage='waiting', game_state=None)
        self.data['seats'] = self.data['seats'][:CATALOG[game_id]['maximum']]
        self.invalidate()

    def seat(self, actor, target, seated):
        self.editable()
        if target not in self.data['members'] or actor not in self.data['members']:
            raise RoomError('你不是房间成员')
        if actor != target and actor != self.data['owner_id']:
            raise RoomError('只有房主可以调整其他成员')
        seats = self.data['seats']
        if seated and target not in seats:
            if len(seats) >= CATALOG.get(self.data['game_id'], {}).get('maximum', 12):
                raise RoomError('座位已满，可以先观战')
            if not self.data['members'][target]['connected']:
                raise RoomError('只能让在线成员入座')
            seats.append(target)
        elif not seated and target in seats:
            seats.remove(target)
        else:
            return
        self.invalidate()

    def ready(self, player_id, ready, revision):
        self.editable()
        if revision != self.data['revision']:
            raise RoomError('房间设置已变化，请确认后重新准备')
        if not self.data['game_id'] or player_id not in self.data['seats']:
            raise RoomError('请先选择游戏并入座')
        member = self.data['members'][player_id]
        if not member['connected']:
            raise RoomError('连接恢复后才能准备')
        member['ready'] = ready
        if not ready:
            self.cancel_countdown()

    def can_start(self):
        d = self.data
        info = CATALOG.get(d['game_id'])
        return bool(info and d['stage'] in ('waiting', 'countdown')
                    and info['minimum'] <= len(d['seats']) <= info['maximum']
                    and all(d['members'][p]['connected'] and d['members'][p]['ready'] for p in d['seats']))

    def arm(self, now=None):
        if self.can_start() and self.data['countdown'] is None:
            self.data['stage'] = 'countdown'
            self.data['countdown'] = dict(token=uuid.uuid4().hex, revision=self.data['revision'],
                                          deadline=(time.time() if now is None else now) + 3)

    def transfer(self, actor, target):
        if actor != self.data['owner_id']:
            raise RoomError('只有房主可以转交房间')
        if self.data['stage'] == 'playing':
            raise RoomError('本局结束后可以转交房间')
        if target not in self.data['members'] or not self.data['members'][target]['connected']:
            raise RoomError('请选择在线成员')
        self.data['owner_id'] = target
        self.data['owner_offline_since'] = None

    def failover(self, now=None):
        now = time.time() if now is None else now
        d = self.data
        if not d['owner_id'] or d['members'][d['owner_id']]['connected']:
            d['owner_offline_since'] = None
            return
        if d['owner_offline_since'] is None:
            d['owner_offline_since'] = now
        if d['stage'] != 'playing' and now - d['owner_offline_since'] >= 60:
            online = next((p for p, m in d['members'].items() if m['connected']), None)
            if online:
                d.update(owner_id=online, owner_offline_since=None)
