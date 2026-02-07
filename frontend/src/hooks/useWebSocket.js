import { useState, useEffect, useRef, useCallback } from 'react';

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

function getPlayerId() {
  let id = localStorage.getItem('cheese_player_id');
  if (!id) {
    id = 'p_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    localStorage.setItem('cheese_player_id', id);
  }
  return id;
}

export default function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [playerId] = useState(getPlayerId);
  const [roomState, setRoomState] = useState(null);
  const [gameInfo, setGameInfo] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [screenShake, setScreenShake] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const heartbeatTimer = useRef(null);
  const reconnectAttempts = useRef(0);

  const addNotification = useCallback((text, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    heartbeatTimer.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping', data: {} }));
      }
    }, 25000); // every 25s
  }, [stopHeartbeat]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    // Clean up any existing connecting socket
    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`${WS_URL}/${playerId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttempts.current = 0;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      startHeartbeat();
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      switch (msg.type) {
        case 'connected':
          // If server says we have an active room, request full state
          if (msg.data.room_id) {
            ws.send(JSON.stringify({ type: 'get_game_info', data: {} }));
          }
          break;
        case 'room_state':
          setRoomState(msg.data);
          // Merge my_info into gameInfo for refresh recovery (Bug3)
          if (msg.data.my_info) {
            setGameInfo(prev => prev ? { ...prev, ...msg.data.my_info } : msg.data.my_info);
          }
          break;
        case 'room_created':
          addNotification(`房间创建成功！房间号：${msg.data.room_id}`, 'success');
          break;
        case 'player_joined':
          addNotification(`${msg.data.name} 加入了房间`, 'info');
          break;
        case 'player_disconnected':
          addNotification(`${msg.data.name} 断线了`, 'warning');
          break;
        case 'player_reconnected':
          addNotification(`${msg.data.name} 重新连接`, 'success');
          break;
        case 'game_start':
          setGameInfo(msg.data);
          addNotification(msg.data.message, 'info');
          break;
        case 'peek_result':
          setGameInfo(prev => ({ ...prev, peek: msg.data }));
          addNotification(`${msg.data.target_name} 的骰子点数是 ${msg.data.dice}`, 'success');
          break;
        case 'accomplice_chosen':
          setGameInfo(prev => ({ ...prev, accomplice: msg.data }));
          addNotification(msg.data.message, 'success');
          break;
        case 'you_are_accomplice':
          setGameInfo(prev => ({ ...prev, ...msg.data, role: 'accomplice' }));
          addNotification(msg.data.message, 'warning');
          // Trigger full-screen shake
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 1500);
          break;
        case 'night_done_ack':
          addNotification(msg.data.message, 'success');
          break;
        case 'day_start':
          addNotification(msg.data.message, 'info');
          break;
        case 'vote_start':
          setNotifications([]); // Clear old vote_requested notifications
          addNotification(msg.data.message, 'warning');
          break;
        case 'game_result':
          setGameInfo(prev => ({ ...prev, result: msg.data }));
          break;
        case 'vote_requested':
          addNotification(`${msg.data.name} 发起了投票 (${msg.data.request_count}/${msg.data.required})`, 'info');
          break;
        case 'new_game':
          setGameInfo(null);
          addNotification(msg.data.message, 'info');
          break;
        case 'left_room':
          setRoomState(null);
          setGameInfo(null);
          break;
        case 'error':
          addNotification(msg.data.message, 'error');
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      stopHeartbeat();
      // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 15000);
      reconnectAttempts.current += 1;
      reconnectTimer.current = setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [playerId, addNotification, startHeartbeat, stopHeartbeat]);

  useEffect(() => {
    connect();

    // Reconnect immediately when page becomes visible (e.g. phone unlock)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          // Clear any pending reconnect and connect now
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
          }
          reconnectAttempts.current = 0;
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    };
  }, [connect]);

  const send = useCallback((type, data = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  return {
    connected,
    playerId,
    roomState,
    gameInfo,
    notifications,
    screenShake,
    send,
  };
}
