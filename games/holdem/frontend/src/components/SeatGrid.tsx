import React from 'react';
import { Room } from '../types';

interface Props {
  room: Room;
  playerId: string;
  onSit: (seat: number) => void;
  onStand: () => void;
}

export default function SeatGrid({ room, playerId, onSit, onStand }: Props) {
  const myPlayer = room.players[playerId];
  const mySeat = myPlayer?.seat ?? -1;

  const seats = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="grid grid-cols-3 gap-3">
      {seats.map(idx => {
        const pid = room.seats[idx];
        const player = pid ? room.players[pid] : null;
        const isMe = pid === playerId;
        const isEmpty = !pid;

        return (
          <button
            key={idx}
            onClick={() => {
              if (isEmpty && mySeat < 0) {
                onSit(idx);
              } else if (isEmpty && mySeat >= 0) {
                onStand();
                setTimeout(() => onSit(idx), 100);
              } else if (isMe) {
                onStand();
              }
            }}
            disabled={!isEmpty && !isMe}
            className={`relative flex flex-col items-center justify-center p-4 rounded-xl border-2 transition min-h-[120px] ${
              isMe
                ? player?.ready
                  ? 'border-green-500 bg-green-900/30'
                  : 'border-blue-500 bg-blue-900/40'
                : player?.ready
                ? 'border-green-600/60 bg-green-900/20'
                : player
                ? 'border-slate-600 bg-slate-800'
                : 'border-dashed border-slate-600 bg-slate-800/50 hover:border-slate-400'
            }`}
          >
            <span className="text-[10px] absolute top-1 left-2 text-slate-500">#{idx + 1}</span>
            {player?.ready && (
              <span className="absolute top-1 right-1.5 text-[9px] font-bold text-green-400 bg-green-900/60 px-1.5 py-0.5 rounded">✓</span>
            )}
            {player ? (
              <>
                <div className="relative">
                  <span className="text-3xl">{player.emoji}</span>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-800 ${player.is_connected ? 'bg-green-400' : 'bg-red-500'}`} />
                </div>
                <span className="text-xs font-medium mt-1 truncate max-w-full">
                  {player.name}
                </span>
                <span className="text-[10px] text-green-400 mt-0.5">
                  {player.chips}
                </span>
                {isMe && (
                  <span className="text-[10px] text-blue-400">(我)</span>
                )}
              </>
            ) : (
              <span className="text-slate-600 text-sm">空座</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
