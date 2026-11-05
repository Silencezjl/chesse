import React, { useEffect } from 'react';
import useWebSocket from './hooks/useWebSocket';
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
    <div className={`min-h-screen flex flex-col `}>
      {window.parent === window && <header className="p-4 text-center border-b border-white/10">
        <h1 className="text-2xl md:text-3xl font-bold">
          <img src="/assets/game-cheese-indigo-v1.webp" alt="" width="48" height="48" className="inline-block align-middle" /> 奶酪大盗{' '}

        </h1>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className={`w-2 h-2 rounded-full ${ws.connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-xs text-white/50">
            {ws.connected ? '已连接' : '连接中...'}
            {ws.connected && ws.latency != null && (
              <span className={`ml-1 ${ws.latency < 100 ? 'text-green-400/60' : ws.latency < 300 ? 'text-yellow-400/60' : 'text-red-400/60'}`}>
                {ws.latency}ms
              </span>
            )}
          </span>
        </div>
      </header>}

      <main className="flex-1 flex items-start justify-center p-4">
        {roomState ? (
          <Room ws={ws} />
        ) : (
          <div className="p-4 text-center">正在连接游戏…</div>
        )}
      </main>

      <Notifications notifications={notifications} />
    </div>
  );
}
