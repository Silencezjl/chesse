import React, { useState } from 'react';
import { Standing, Room } from '../types';

interface FinalStandingsProps {
  standings: Standing[];
  room: Room | null;
  onClose: () => void;
}

const GROUP_NAMES = ['A组', 'B组', 'C组', 'D组', 'E组', 'F组', 'G组', 'H组', 'I组', 'J组'];

const GROUP_COLORS = [
  { bg: 'bg-blue-900/30', border: 'border-blue-500', text: 'text-blue-400', activeBg: 'bg-blue-600 text-white', badge: 'bg-blue-500 text-white' },
  { bg: 'bg-purple-900/30', border: 'border-purple-500', text: 'text-purple-400', activeBg: 'bg-purple-600 text-white', badge: 'bg-purple-500 text-white' },
  { bg: 'bg-pink-900/30', border: 'border-pink-500', text: 'text-pink-400', activeBg: 'bg-pink-600 text-white', badge: 'bg-pink-500 text-white' },
  { bg: 'bg-teal-900/30', border: 'border-teal-500', text: 'text-teal-400', activeBg: 'bg-teal-600 text-white', badge: 'bg-teal-500 text-white' },
  { bg: 'bg-orange-900/30', border: 'border-orange-500', text: 'text-orange-400', activeBg: 'bg-orange-600 text-white', badge: 'bg-orange-500 text-white' },
  { bg: 'bg-indigo-900/30', border: 'border-indigo-500', text: 'text-indigo-400', activeBg: 'bg-indigo-600 text-white', badge: 'bg-indigo-500 text-white' },
  { bg: 'bg-emerald-900/30', border: 'border-emerald-500', text: 'text-emerald-400', activeBg: 'bg-emerald-600 text-white', badge: 'bg-emerald-500 text-white' },
  { bg: 'bg-amber-900/30', border: 'border-amber-500', text: 'text-amber-400', activeBg: 'bg-amber-600 text-white', badge: 'bg-amber-500 text-white' },
  { bg: 'bg-rose-900/30', border: 'border-rose-500', text: 'text-rose-400', activeBg: 'bg-rose-600 text-white', badge: 'bg-rose-500 text-white' },
  { bg: 'bg-cyan-900/30', border: 'border-cyan-500', text: 'text-cyan-400', activeBg: 'bg-cyan-600 text-white', badge: 'bg-cyan-500 text-white' },
];

const getGroupColor = (gId: number, type: 'bg' | 'border' | 'text' | 'activeBg' | 'badge') => {
  const idx = (gId - 1) % GROUP_COLORS.length;
  return GROUP_COLORS[idx][type];
};

export default function FinalStandings({ 
  standings, 
  room, 
  onClose 
}: FinalStandingsProps) {
  const [activeGroup, setActiveGroup] = useState<number>(1);
  const [playerGroups, setPlayerGroups] = useState<Record<string, number>>({});

  const togglePlayer = (id: string) => {
    setPlayerGroups(prev => {
      const next = { ...prev };
      if (next[id] === activeGroup) {
        delete next[id];
      } else {
        next[id] = activeGroup;
      }
      return next;
    });
  };

  const totalNet = standings.reduce((sum, s) => sum + s.net, 0);
  const isBalanced = totalNet === 0;

  const maxGroups = Math.min(10, Math.max(1, standings.length));
  const availableGroups = Array.from({ length: maxGroups }, (_, i) => i + 1);

  const groupSummaries = availableGroups.map(gId => {
    const players = standings.filter(s => playerGroups[s.player_id] === gId);
    const net = players.reduce((sum, s) => sum + s.net, 0);
    return { gId, players, net };
  });

  const hasAnyGroup = groupSummaries.some(g => g.players.length > 1);

  return (
    <div className="flex flex-col h-[100dvh] max-w-lg mx-auto overflow-hidden">
      <h2 className="text-2xl font-bold text-center text-white mb-1">🏆 最终结算</h2>
      
      {/* 总体平账检查 */}
      <div className={`mt-2 mb-4 p-2 rounded-lg text-center text-sm font-medium ${isBalanced ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
        {isBalanced ? '✅ 账目已平 (总净胜负: 0)' : `⚠️ 账目不平 (总净胜负: ${totalNet})`}
      </div>

      {/* 分组选择器 */}
      <div className="mb-4">
        <p className="text-center text-xs text-slate-400 mb-2">选择分组后点击玩家，支持多组独立合并计算</p>
        <div className="flex gap-2 justify-center flex-wrap">
          {availableGroups.map(gId => (
            <button
              key={gId}
              onClick={() => setActiveGroup(gId)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeGroup === gId ? getGroupColor(gId, 'activeBg') : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {GROUP_NAMES[gId - 1]}
            </button>
          ))}
        </div>
      </div>
      
      {/* 多人合并计算面板 */}
      {hasAnyGroup && (
        <div className="mb-4 space-y-2">
          {groupSummaries.map(({ gId, players, net }) => (
            players.length > 1 && (
              <div key={gId} className={`p-3 rounded-xl ${getGroupColor(gId, 'bg')} border ${getGroupColor(gId, 'border')} flex justify-between items-center`}>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${getGroupColor(gId, 'badge')}`}>
                    {GROUP_NAMES[gId - 1]}
                  </span>
                  <span className={`text-sm ${getGroupColor(gId, 'text')}`}>
                    {players.length} 人合并
                  </span>
                </div>
                <span className={`text-lg font-bold ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {net >= 0 ? '+' : ''}{net}
                </span>
              </div>
            )
          ))}
        </div>
      )}

      <div className="space-y-2">
        {standings.map((s: Standing, idx: number) => {
          const gId = playerGroups[s.player_id];
          const isSelected = !!gId;
          
          let cardClass = '';
          if (isSelected) {
            cardClass = `${getGroupColor(gId, 'border')} ${getGroupColor(gId, 'bg')}`;
          } else {
            cardClass = idx === 0 ? 'border-yellow-500 bg-yellow-900/20' :
                        s.net >= 0 ? 'border-green-700/50 bg-slate-800' : 'border-red-700/50 bg-slate-800';
          }

          return (
            <div 
              key={s.player_id} 
              onClick={() => togglePlayer(s.player_id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition ${cardClass}`}
            >
              <span className="text-lg font-bold text-slate-400 w-6">
                {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
              </span>
              <span className="text-xl">{s.player_emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{s.player_name}</span>
                  {isSelected && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${getGroupColor(gId, 'badge')}`}>
                      {GROUP_NAMES[gId - 1]}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">
                  筹码 {s.chips}
                  {s.total_rebuys > 0 && ` · 补码 ${s.total_rebuys * (room?.initial_chips || 0)}`}
                  {s.total_cashouts > 0 && ` · 清码 ${s.total_cashouts}`}
                </div>
              </div>
              <span className={`text-lg font-bold ${s.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {s.net >= 0 ? '+' : ''}{s.net}
              </span>
            </div>
          );
        })}
      </div>
      <button
        onClick={onClose}
        className="mt-6 w-full py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold transition"
      >
        返回首页
      </button>
    </div>
  );
}
