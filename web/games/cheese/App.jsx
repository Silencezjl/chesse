import {usePlatform} from '../../platform/context';
import React, { useEffect } from 'react';
import useWebSocket from './hooks/useWebSocket';
import Room from './components/Room';
import Notifications from './components/Notifications';

export default function App() {
  const platform = usePlatform();
  const ws = useWebSocket(platform);
  useEffect(()=>platform.onConnection(ws.connected),[ws.connected]);
  const { roomState, notifications } = ws;


  return (
    <div className={`min-h-full flex flex-col `}>
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
