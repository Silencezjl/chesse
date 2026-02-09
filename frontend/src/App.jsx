import React, { useEffect } from 'react';
import useWebSocket from './hooks/useWebSocket';
import Lobby from './components/Lobby';
import Room from './components/Room';
import Notifications from './components/Notifications';

export default function App() {
  const ws = useWebSocket();
  const { roomState, notifications } = ws;

  // Switch body background theme based on game phase
  useEffect(() => {
    const phase = roomState?.phase;
    const themeMap = {
      waiting: 'theme-dark',
      night: 'theme-night',
      day: 'theme-day',
      voting: 'theme-day',
      result: 'theme-result',
    };
    const theme = themeMap[phase] || 'theme-dark';
    document.body.className = theme;
    return () => { document.body.className = 'theme-dark'; };
  }, [roomState?.phase]);

  return (
    <div className={`min-h-screen flex flex-col ${ws.screenShake ? 'animate-screen-shake' : ''}`}>
      <header className="p-4 text-center border-b border-white/10">
        <h1 className="text-2xl md:text-3xl font-bold">
          <span className="text-cheese-400">🧀</span> 奶酪大盗{' '}
          <span className="text-cheese-400">🐭</span>
        </h1>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className={`w-2 h-2 rounded-full ${ws.connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-xs text-white/50">
            {ws.connected ? '已连接' : '连接中...'}
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center p-4">
        {roomState ? (
          <Room ws={ws} />
        ) : (
          <Lobby ws={ws} />
        )}
      </main>

      <Notifications notifications={notifications} />
    </div>
  );
}
