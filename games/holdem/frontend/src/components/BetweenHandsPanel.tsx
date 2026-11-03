import React from 'react';
import { Room } from '../types';

interface Props {
  room: Room;
  playerId: string;
  isOwner: boolean;
  canRebuy: boolean;
  canCashout: boolean;
  countdown: number | null;
  onRebuy: () => void;
  onCashout: () => void;
  onEndGame: () => void;
}

export default function BetweenHandsPanel({ 
  room, 
  playerId, 
  isOwner, 
  canRebuy, 
  canCashout, 
  countdown, 
  onRebuy, 
  onCashout, 
  onEndGame 
}: Props) {
  const myPlayer = room.players[playerId];

  return (
    <>
      <div className="bg-slate-800 rounded-xl p-4 text-center space-y-2">
        {canCashout ? (
          <p className="text-sm text-purple-400">筹码超过上限 ({room.max_chips})，请清码后继续</p>
        ) : canRebuy ? (
          <p className="text-sm text-orange-400">筹码不足，请补码后继续</p>
        ) : countdown !== null ? (
          <div>
            <p className="text-slate-400 text-sm">下一手自动开始</p>
            <p className="text-4xl font-bold text-white mt-1">{countdown}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {myPlayer?.ready ? (
              <p className="text-green-400 text-sm">✓ 已准备，等待其他玩家...</p>
            ) : (
              <p className="text-slate-400 text-sm">请点击准备</p>
            )}
            {Object.values(room.players).filter(p => p.seat >= 0 && !p.ready).length > 0 && (
              <p className="text-[11px] text-slate-500">
                等待: {Object.values(room.players)
                  .filter(p => p.seat >= 0 && !p.ready)
                  .map(p => p.name)
                  .join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Owner end game button */}
      {isOwner && (
        <button onClick={onEndGame} className="w-full py-2 bg-red-900/60 hover:bg-red-800 border border-red-700 rounded-xl text-red-300 font-medium text-sm transition">
          结束游戏 · 最终结算
        </button>
      )}
    </>
  );
}
