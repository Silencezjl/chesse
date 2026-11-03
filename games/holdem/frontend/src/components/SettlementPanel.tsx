import React, { useState, useEffect, useRef } from 'react';
import { Room } from '../types';

interface Props {
  room: Room;
  playerId: string;
  onPropose: (potWinners: Record<string, string[]>) => void;
  onConfirm: () => void;
  onReject: () => void;
}

export default function SettlementPanel({ room, playerId, onPropose, onConfirm, onReject }: Props) {
  const hand = room.hand;
  const [potWinners, setPotWinners] = useState<Record<string, string[]>>({});
  const autoInitDone = useRef(false);

  const pots = hand?.pots || [];
  const proposal = hand?.settlement_proposal;

  // Auto-select winner for pots with only one eligible player
  useEffect(() => {
    if (!hand || hand.phase !== 'showdown' || pots.length === 0 || autoInitDone.current) return;
    autoInitDone.current = true;
    const auto: Record<string, string[]> = {};
    for (const pot of pots) {
      if (pot.eligible_players.length === 1) {
        auto[pot.id] = [pot.eligible_players[0]];
      }
    }
    if (Object.keys(auto).length > 0) {
      setPotWinners(prev => ({ ...auto, ...prev }));
    }
  }, [hand, pots]);

  if (!hand || hand.phase !== 'showdown') return null;
  const activePlayers = Object.values(room.players).filter(
    p => p.seat >= 0 && p.status !== 'folded' && p.status !== 'sitting_out'
  );
  const activeIds = activePlayers.map(p => p.id);
  const myConfirmed = proposal?.confirmed_by?.includes(playerId) ?? false;

  const toggleWinner = (potId: string, pid: string) => {
    setPotWinners(prev => {
      const current = prev[potId] || [];
      if (current.includes(pid)) {
        return { ...prev, [potId]: current.filter(id => id !== pid) };
      } else {
        return { ...prev, [potId]: [...current, pid] };
      }
    });
  };

  // If there's a proposal, show confirm/reject UI
  if (proposal) {
    const proposer = room.players[proposal.proposer_id];
    const confirmedCount = proposal.confirmed_by?.length ?? 0;
    const totalNeeded = activeIds.length;

    return (
      <div className="bg-slate-800 rounded-xl p-4 space-y-3">
        <div className="text-center">
          <h3 className="text-lg font-bold text-yellow-400">🏆 结算确认</h3>
          <p className="text-xs text-slate-400 mt-1">
            {proposer?.emoji} {proposer?.name} 发起了结算方案
          </p>
        </div>

        {/* Show proposed winners */}
        {pots.map((pot, idx) => {
          const winners = proposal.pot_winners[pot.id] || [];
          return (
            <div key={pot.id} className="bg-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-white">
                  {idx === 0 ? '主池' : `边池 ${idx}`}
                </span>
                <span className="text-sm font-bold text-yellow-400">{pot.amount}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {winners.map(wid => {
                  const w = room.players[wid];
                  if (!w) return null;
                  const share = Math.floor(pot.amount / winners.length);
                  return (
                    <span key={wid} className="text-xs bg-yellow-900/40 text-yellow-300 px-2 py-0.5 rounded">
                      {w.emoji} {w.name} (+{share})
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Confirmation progress */}
        <div className="text-center text-xs text-slate-400">
          已确认 {confirmedCount}/{totalNeeded}
          <div className="flex flex-wrap justify-center gap-1 mt-1">
            {activeIds.map(pid => {
              const p = room.players[pid];
              const confirmed = proposal.confirmed_by?.includes(pid);
              return (
                <span key={pid} className={`text-[10px] px-1.5 py-0.5 rounded ${
                  confirmed ? 'bg-green-900/40 text-green-400' : 'bg-slate-700 text-slate-500'
                }`}>
                  {p?.emoji} {confirmed ? '✓' : '...'}
                </span>
              );
            })}
          </div>
        </div>

        {/* Action buttons */}
        {!myConfirmed ? (
          <div className="flex gap-2">
            <button
              onClick={onConfirm}
              className="flex-1 py-3 bg-green-600 hover:bg-green-700 rounded-xl text-white font-bold transition"
            >
              ✓ 确认
            </button>
            <button
              onClick={onReject}
              className="flex-1 py-3 bg-red-900/60 hover:bg-red-800 border border-red-700 rounded-xl text-red-300 font-bold transition"
            >
              ✕ 不认可
            </button>
          </div>
        ) : (
          <div className="text-center text-sm text-green-400 py-2">
            ✓ 你已确认，等待其他玩家...
          </div>
        )}
      </div>
    );
  }

  // No proposal yet - show winner selection UI
  const allPotsHaveWinners = pots.every(pot => (potWinners[pot.id] || []).length > 0);

  return (
    <div className="bg-slate-800 rounded-xl p-4 space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-bold text-yellow-400">🏆 摊牌结算</h3>
        <p className="text-xs text-slate-400 mt-1">为每个池选择赢家（可多选表示平分），提交后需所有玩家确认</p>
      </div>

      {pots.map((pot, idx) => (
        <div key={pot.id} className="bg-slate-700/50 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">
              {idx === 0 ? '主池' : `边池 ${idx}`}
            </span>
            <span className="text-lg font-bold text-yellow-400">{pot.amount}</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {pot.eligible_players.map(pid => {
              const p = room.players[pid];
              if (!p) return null;
              const isSelected = (potWinners[pot.id] || []).includes(pid);
              const isSinglePlayer = pot.eligible_players.length === 1;
              return (
                <button
                  key={pid}
                  onClick={() => { if (!isSinglePlayer) toggleWinner(pot.id, pid); }}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition text-left ${
                    isSelected
                      ? 'border-yellow-500 bg-yellow-900/30 text-yellow-300'
                      : 'border-slate-600 bg-slate-700 text-slate-300 hover:border-slate-500'
                  } ${isSinglePlayer ? 'opacity-80 cursor-default' : ''}`}
                >
                  <span>{p.emoji}</span>
                  <span className="text-xs truncate">{p.name}</span>
                  {isSelected && <span className="ml-auto text-yellow-400">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button
        onClick={() => { if (allPotsHaveWinners) onPropose(potWinners); }}
        disabled={!allPotsHaveWinners}
        className="w-full py-3 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 disabled:text-slate-400 rounded-xl text-white font-bold text-lg transition"
      >
        {allPotsHaveWinners ? '提交结算方案' : '请为每个池选择赢家'}
      </button>
    </div>
  );
}
