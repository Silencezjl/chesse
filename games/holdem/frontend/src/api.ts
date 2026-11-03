const API_BASE = import.meta.env.VITE_API_URL || '';
const WS_BASE = import.meta.env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

export async function fetchRooms() {
  const res = await fetch(`${API_BASE}/api/rooms`);
  return res.json();
}

export async function createRoom(data: {
  player_name: string;
  player_emoji: string;
  sb_amount: number;
  initial_chips: number;
  rebuy_minimum: number;
  hand_interval?: number;
  max_chips?: number;
  device_id: string;
}) {
  const res = await fetch(`${API_BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function joinRoom(data: {
  room_id: string;
  player_name: string;
  player_emoji: string;
  device_id: string;
}) {
  const res = await fetch(`${API_BASE}/api/rooms/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function checkPlayerRoom(playerId: string): Promise<{ room_id: string | null }> {
  const res = await fetch(`${API_BASE}/api/player-room/${playerId}`);
  return res.json();
}

export async function leaveRoom(roomId: string, playerId: string) {
  const res = await fetch(`${API_BASE}/api/rooms/${roomId}/leave/${playerId}`, { method: 'POST' });
  return res.json();
}

export async function getRandomProfile() {
  const res = await fetch(`${API_BASE}/api/random-profile`);
  return res.json();
}

export function connectWs(roomId: string, playerId: string): WebSocket {
  return new WebSocket(`${WS_BASE}/ws/${roomId}/${playerId}`);
}
