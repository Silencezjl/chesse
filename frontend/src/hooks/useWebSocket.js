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

  const addNotification = useCallback((text, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_URL}/${playerId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
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
      reconnectTimer.current = setTimeout(() => {
        connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [playerId, addNotification]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
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
