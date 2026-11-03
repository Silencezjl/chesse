import { create } from 'zustand';
import { Room, Standing } from './types';

function getDeviceId(): string {
  let id = localStorage.getItem('holdem_device_id');
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 8)}`;
    localStorage.setItem('holdem_device_id', id);
  }
  return id;
}

interface AppState {
  playerId: string;
  playerName: string;
  playerEmoji: string;
  roomId: string | null;
  room: Room | null;
  ws: WebSocket | null;
  connected: boolean;
  latency: number;
  error: string | null;
  events: Array<{ id: number; text: string; time: number }>;
  eventCounter: number;
  standings: Standing[] | null;
  phaseNotice: string | null;

  setPlayer: (id: string, name: string, emoji: string) => void;
  setProfile: (name: string, emoji: string) => void;
  setRoom: (room: Room | null) => void;
  setRoomId: (id: string | null) => void;
  setWs: (ws: WebSocket | null) => void;
  setConnected: (c: boolean) => void;
  setLatency: (ms: number) => void;
  setError: (e: string | null) => void;
  addEvent: (text: string) => void;
  setStandings: (s: Standing[] | null) => void;
  setPhaseNotice: (n: string | null) => void;
  reset: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  playerId: getDeviceId(),
  playerName: localStorage.getItem('holdem_player_name') || '',
  playerEmoji: localStorage.getItem('holdem_player_emoji') || '',
  roomId: localStorage.getItem('holdem_room_id'),
  room: null,
  ws: null,
  connected: false,
  latency: 0,
  error: null,
  events: [],
  eventCounter: 0,
  standings: null,
  phaseNotice: null,

  setPlayer: (id, name, emoji) => {
    localStorage.setItem('holdem_player_name', name);
    localStorage.setItem('holdem_player_emoji', emoji);
    set({ playerName: name, playerEmoji: emoji });
  },
  setProfile: (name, emoji) => {
    localStorage.setItem('holdem_player_name', name);
    localStorage.setItem('holdem_player_emoji', emoji);
    set({ playerName: name, playerEmoji: emoji });
  },
  setRoom: (room) => set({ room }),
  setRoomId: (id) => {
    if (id) localStorage.setItem('holdem_room_id', id);
    else localStorage.removeItem('holdem_room_id');
    set({ roomId: id });
  },
  setWs: (ws) => set({ ws }),
  setConnected: (c) => set({ connected: c }),
  setLatency: (ms) => set({ latency: ms }),
  setError: (e) => set({ error: e }),
  addEvent: (text) => {
    const { events, eventCounter } = get();
    const newEvents = [...events, { id: eventCounter, text, time: Date.now() }].slice(-20);
    set({ events: newEvents, eventCounter: eventCounter + 1 });
  },
  setStandings: (s) => set({ standings: s }),
  setPhaseNotice: (n) => set({ phaseNotice: n }),
  reset: () => {
    const { ws } = get();
    if (ws) ws.close();
    localStorage.removeItem('holdem_room_id');
    set({
      roomId: null,
      room: null,
      ws: null,
      connected: false,
      latency: 0,
      error: null,
      events: [],
      standings: null,
      phaseNotice: null,
    });
  },
}));
