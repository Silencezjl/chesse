import React from 'react';
import { Room } from '../types';

interface Props {
  room: Room;
  playerId: string;
  isSeated: boolean;
  canRebuy: boolean;
  onReady: () => void;
  onRebuy: () => void;
}

export default function FirstHandPanel({ 
  room, 
  playerId, 
  isSeated, 
  canRebuy, 
  onReady, 
  onRebuy 
}: Props) {
  const myPlayer = room.players[playerId];

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

      {isSeated && (
        <div className="space-y-2">
          <button
            onClick={onReady}
            className={`w-full py-3 rounded-xl font-bold text-lg transition ${
              myPlayer.ready ? 'bg-green-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {myPlayer.ready ? '✓ 已准备 (点击取消)' : '准备'}
          </button>
          {canRebuy && (
            <button onClick={onRebuy} className="w-full py-2 bg-orange-600 hover:bg-orange-700 rounded-xl text-white font-medium transition">
              补码 → {room.initial_chips}
            </button>
          )}
        </div>
      )}

      <div className="text-center text-xs text-slate-500">
        {Object.values(room.players).filter(p => p.seat >= 0).length} 人就座 ·{' '}
        {Object.values(room.players).filter(p => p.ready).length} 人准备 · 至少需要 2 人
      </div>
    </>
  );
}
