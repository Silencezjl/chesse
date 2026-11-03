import React from 'react';

interface Props {
  roomId: string;
  handNumber: number;
  sbAmount: number;
  bbAmount: number;
  connected: boolean;
  latency: number;
  isPlaying: boolean;
  onLeave: () => void;
}

export default function RoomTopBar({ 
  roomId, 
  handNumber, 
  sbAmount, 
  bbAmount, 
  connected, 
  latency, 
  isPlaying, 
  onLeave 
}: Props) {
  return (
    <div className="flex-none z-10 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!isPlaying && (
            <button onClick={onLeave} className="text-slate-500 hover:text-white text-[11px]">退出</button>
          )}
          <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-400">#{roomId}</span>
          {handNumber > 0 && (
            <span className="text-[11px] text-slate-500">第{handNumber}手</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>SB:{sbAmount}</span>
          <span>BB:{bbAmount}</span>
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {connected ? '●' : '○'}
          </span>
          <span className="text-slate-500">{latency}ms</span>
        </div>
      </div>
    </div>
  );
}
