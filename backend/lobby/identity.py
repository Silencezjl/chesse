"""Anonymous device credentials for lobby and game connections."""
import hashlib
import secrets
import uuid

from fastapi import HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse

COOKIE = 'lobby_session'
PREFIX = 'lobby:identity:v1:'


def key(token):
    return PREFIX + hashlib.sha256(token.encode()).hexdigest()


async def player_for_token(token):
    from lobby import api
    if not token or len(token) > 128:
        return None
    return await api.db().get(key(token))


async def issue(request: Request):
    from lobby import api
    token = request.cookies.get(COOKIE)
    player_id = await player_for_token(token)
    if not player_id:
        token = secrets.token_urlsafe(32)
        player_id = uuid.uuid4().hex
        await api.db().set(key(token), player_id, ex=31536000)
    else:
        await api.db().expire(key(token), 31536000)
    response = JSONResponse({'player_id': player_id}, headers={'Cache-Control': 'no-store'})
    response.set_cookie(COOKIE, token, httponly=True, samesite='strict', secure=request.url.scheme == 'https', max_age=31536000, path='/')
    return response


async def authorize(request: Request):
    player_id = await player_for_token(request.cookies.get(COOKIE))
    if request.method == 'POST':
        try:
            claimed = (await request.json()).get('player_id')
        except (ValueError, AttributeError):
            claimed = None
    else:
        claimed = request.path_params.get('player_id') or request.query_params.get('player_id')
    if not player_id or player_id != claimed:
        raise HTTPException(403, '身份验证失败，请刷新页面')


async def socket_authorized(ws: WebSocket, player_id: str):
    return await player_for_token(ws.cookies.get(COOKIE)) == player_id
