import React from 'react';
import { Room } from '../types';

interface Props {
  room: Room;
}

export default function FirstHandPanel({ room }: Props) {
  return (
    <>
      <div className="bg-slate-800/50 rounded-xl p-3 text-center">
        <p className="text-sm text-slate-400">
          初始筹码: <span className="text-white font-bold">{room.initial_chips}</span>
          {room.rebuy_minimum > 0 && (
            <span className="ml-2">补码限额: <span className="text-white font-bold">≤{room.rebuy_minimum}</span></span>
          )}
          {room.rebuy_minimum === 0 && (
            <span className="ml-2 text-slate-500">清零可补码</span>
          )}
        </p>
      </div>

      <div className="text-center text-xs text-slate-500">
        {Object.values(room.players).filter(p => p.seat >= 0).length} 人就座 ·{' '}
        {Object.values(room.players).filter(p => p.ready).length} 人准备 · 至少需要 2 人
      </div>
    </>
  );
}
