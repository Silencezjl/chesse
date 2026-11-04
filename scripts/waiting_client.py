"""Shared smoke-test helpers for the server-authoritative waiting room."""
import asyncio
import json
import urllib.request
import urllib.error

async def configure_and_ready(request, room_id, owner, game_id, participants, options=None):
    """request is an async (path, body=None) JSON function; lobby sockets must be open."""
    room = await request(f'/lobby/rooms/{room_id}?player_id={owner}')
    if room['stage'] == 'finished':
        await request(f'/lobby/rooms/{room_id}/return', {'player_id':owner})
    room = await request(f'/lobby/rooms/{room_id}/game', {'player_id':owner,'game_id':game_id,'options':options or {}})
    for pid in list(room['seats']):
        if pid not in participants:
            room = await request(f'/lobby/rooms/{room_id}/seat', {'player_id':owner,'target_id':pid,'seated':False})
    for pid in participants:
        if pid not in room['seats']:
            room = await request(f'/lobby/rooms/{room_id}/seat', {'player_id':owner,'target_id':pid,'seated':True})
    revision=room['revision']
    await asyncio.gather(*(request(f'/lobby/rooms/{room_id}/ready', {'player_id':pid,'ready':True,'revision':revision}) for pid in participants))
    for _ in range(60):
        room=await request(f'/lobby/rooms/{room_id}?player_id={owner}')
        if room['stage']=='playing':return room
        if room.get('start_error'):raise AssertionError(room['start_error'])
        await asyncio.sleep(.1)
    raise AssertionError('Automatic start timed out')
