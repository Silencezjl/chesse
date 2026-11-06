const WS_BASE = import.meta.env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

export function connectWs(roomId: string, playerId: string): WebSocket {
  return new WebSocket(`${WS_BASE}/holdem-ws/${roomId}/${playerId}`);
}
