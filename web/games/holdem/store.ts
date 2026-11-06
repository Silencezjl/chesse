import { createStore, useStore as useZustandStore } from 'zustand';
import {createContext,useContext} from 'react';
import { Room, Standing } from './types';

interface AppState {
  playerId: string;
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

export const createGameStore = () => createStore<AppState>((set, get) => ({
  playerId: '',
  roomId: null,
  room: null,
  ws: null,
  connected: false,
  latency: 0,
  error: null,
  events: [],
  eventCounter: 0,
  standings: null,
  phaseNotice: null,

  setRoom: (room) => set({ room }),
  setRoomId: (id) => {
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

export const StoreContext=createContext<ReturnType<typeof createGameStore>>(null!);
export const useGameStore=()=>useContext(StoreContext);
export const useStore=()=>useZustandStore(useGameStore());
