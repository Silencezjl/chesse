import { useEffect, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { connectWs } from '../api';
import { Standing } from '../types';
import { WinInfo } from '../components/WinChipsAnimation';

export function useRoomWebSocket(roomId: string | null) {
  const navigate = useNavigate();
  const {
    playerId, room,
    setRoom, setRoomId, setWs, setConnected, setLatency, addEvent, setError,
    setStandings, setPhaseNotice,
  } = useStore();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const pingTimer = useRef<NodeJS.Timeout | null>(null);

  // Win chips animation state ref
  const pendingSingleWinRef = useRef<{ winner: string; winner_name: string; pot: number } | null>(null);
  const winAnimPlayingRef = useRef(false);
  const [winAnimPlaying, setWinAnimPlaying] = useState(false);
  const [winAnimationData, setWinAnimationData] = useState<WinInfo[] | null>(null);
  const potPositionRef = useRef<{ x: number; y: number; width: number } | null>(null);
  const [winAnimPotPos, setWinAnimPotPos] = useState<{ x: number; y: number; width: number } | null>(null);

  const connect = useCallback(() => {
    if (!roomId || !playerId) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const socket = connectWs(roomId, playerId);

    socket.onopen = () => {
      setConnected(true);
      setError(null);
      // Start ping interval
      pingTimer.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      }, 3000);
    };

    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'pong') {
          setLatency(Date.now() - data.timestamp);
        } else if (data.type === 'room_state') {
          setRoom(data.room);
        } else if (data.type === 'event') {
          if (data.event === 'game_ended' && data.standings) {
            setStandings(data.standings as Standing[]);
          }
          if (data.event === 'action' && data.action === 'all_in') {
            // Trigger speech synthesis for all-in
            if ('speechSynthesis' in window) {
              const text = `${data.player_name} All in`;
              const utterance = new SpeechSynthesisUtterance(text);
              utterance.lang = 'zh-CN';
              utterance.rate = 1.1; 
              utterance.pitch = 1.1;
              window.speechSynthesis.speak(utterance);
              // iOS Safari 修复：在 WebSocket 的异步回调中触发语音极易被挂起，
              // 必须在 speak() 之后显式调用 resume()。另外千万不能用 cancel()，它会导致 iOS 的语音队列永久卡死。
              window.speechSynthesis.resume();
            }
          }
          // Capture single-winner (fold victory) events for win animation
          const winEvent = data.single_winner ? data : data.phase_change?.single_winner ? data.phase_change : null;
          if (winEvent && winEvent.single_winner && winEvent.winner && winEvent.pot) {
            pendingSingleWinRef.current = { winner: winEvent.winner, winner_name: winEvent.winner_name, pot: winEvent.pot };
            setTimeout(() => {
              const ev = pendingSingleWinRef.current;
              if (!ev) return;
              pendingSingleWinRef.current = null;
              const currentRoom = useStore.getState().room;
              const p = currentRoom?.players[ev.winner];
              if (p && ev.pot > 0 && !winAnimPlayingRef.current) {
                winAnimPlayingRef.current = true;
                setWinAnimPlaying(true);
                const savedPos = potPositionRef.current || { x: window.innerWidth / 2, y: window.innerHeight / 3, width: window.innerWidth * 0.8 };
                setWinAnimPotPos(savedPos);
                const winInfos: WinInfo[] = [{ playerId: ev.winner, playerEmoji: p.emoji, playerName: ev.winner_name || p.name, amount: ev.pot }];
                setTimeout(() => setWinAnimationData(winInfos), 100);
              }
            }, 50);
          }
          addEvent(data.event + (data.detail ? `: ${data.detail}` : ''));
        } else if (data.type === 'error') {
          setError(data.message);
          setTimeout(() => setError(null), 3000);
        }
      } catch { }
    };

    socket.onclose = (event) => {
      setConnected(false);
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (event.code === 4001) {
        // Invalid room or player - redirect to home
        setRoomId(null);
        navigate('/');
        return;
      }
      reconnectTimer.current = setTimeout(() => connect(), 2000);
    };

    socket.onerror = () => {
      setConnected(false);
    };

    wsRef.current = socket;
    setWs(socket);
  }, [roomId, playerId, setRoom, setWs, setConnected, setLatency, addEvent, setError, setStandings, setRoomId, navigate]);

  useEffect(() => {
    if (!playerId || !roomId) {
      navigate('/');
      return;
    }
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [playerId, roomId, connect, navigate]);

  const send = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return {
    wsRef,
    send,
    winAnimPlayingRef,
    winAnimPlaying,
    setWinAnimPlaying,
    winAnimationData,
    setWinAnimationData,
    potPositionRef,
    winAnimPotPos,
    setWinAnimPotPos
  };
}
