import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Room, Player, HandState } from '../types';
import ChipDisplay, { PotChipDisplay, decomposeChips, ChipDenom } from './ChipDisplay';
import FlipCard from './FlipCard';

interface Props {
  room: Room;
  playerId: string;
  phaseNotice?: string | null;
}

const PHASE_CN: Record<string, string> = {
  hand_start: '开始',
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
  hand_end: '结束',
};

function getRoleLabel(room: Room, seatIdx: number): string | null {
  const hand = room.hand;
  if (!hand) return null;
  if (hand.dealer_seat === seatIdx) return 'D';
  if (hand.sb_seat === seatIdx) return 'SB';
  if (hand.bb_seat === seatIdx) return 'BB';
  return null;
}

function getRoleBadgeColor(role: string): string {
  switch (role) {
    case 'D': return 'bg-yellow-500 text-black';
    case 'SB': return 'bg-cyan-600 text-white';
    case 'BB': return 'bg-orange-600 text-white';
    default: return 'bg-slate-600';
  }
}

function formatAction(action: string | null): { text: string; color: string } | null {
  if (!action) return null;
  if (action === 'fold') return { text: 'Fold', color: 'text-red-400' };
  if (action === 'check') return { text: 'Check', color: 'text-cyan-400' };
  if (action.startsWith('call:')) return { text: `Call ${action.split(':')[1]}`, color: 'text-green-400' };
  if (action.startsWith('raise:')) return { text: `Raise ${action.split(':')[1]}`, color: 'text-blue-400' };
  if (action.startsWith('all_in:')) return { text: `All-In ${action.split(':')[1]}`, color: 'text-red-500' };
  if (action.startsWith('sb:')) return { text: `SB ${action.split(':')[1]}`, color: 'text-cyan-500' };
  if (action.startsWith('bb:')) return { text: `BB ${action.split(':')[1]}`, color: 'text-orange-400' };
  return null;
}

export default function PlayerCards({ room, playerId, phaseNotice }: Props) {
  const hand = room.hand;
  const seatedPlayers = Object.values(room.players)
    .filter(p => p.seat >= 0)
    .sort((a, b) => a.seat - b.seat);

  // Build ordered player list (without folded players for current hand)
  const orderedPlayers = (() => {
    const visible = seatedPlayers.filter(p => p.status !== 'folded');
    
    // Sort logic here if needed (e.g., current player first, then action order)
    // For now, keep original seat order
    return visible;
  })();

  if (seatedPlayers.length === 0) return null;

  return (
    <div>
      {/* Phase display with community cards */}
      {hand && (
        <div className="relative flex items-center gap-3 px-3.5 py-2.5 bg-gradient-to-r from-blue-900/30 to-indigo-900/20 border border-blue-700/40 rounded-xl mb-3">
          <div className="flex items-baseline gap-2 flex-shrink-0">
            <span className="text-xl font-bold text-blue-400">阶段</span>
            <span className="text-lg font-bold text-blue-300">{PHASE_CN[hand.phase] || hand.phase}</span>
          </div>
          <div className="flex-1 flex justify-end gap-1">
            {[1, 2, 3, 4, 5].map(i => {
              const faceUp =
                (hand.phase === 'flop' && i <= 3) ||
                (hand.phase === 'turn' && i <= 4) ||
                ((hand.phase === 'river' || hand.phase === 'showdown') && i <= 5);
              // Sequential delay: always stagger by card index regardless of phase
              const delayMap: Record<number, number> = { 1: 0, 2: 0.15, 3: 0.3, 4: 0.45, 5: 0.6 };
              return (
                <FlipCard
                  key={i}
                  faceUp={faceUp}
                  frontSrc={`/card/${i}.svg`}
                  backSrc="/card/back.svg"
                  delay={delayMap[i]}
                  height={48}
                />
              );
            })}
          </div>
          <AnimatePresence>
            {phaseNotice && (
              <motion.div
                className="absolute inset-0 flex items-center justify-start pl-2 z-20 pointer-events-none"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.35, ease: 'backOut' }}
              >
                <span className="bg-indigo-600/90 backdrop-blur-sm text-white font-bold text-lg px-6 py-1.5 rounded-full shadow-[0_0_20px_rgba(99,102,241,0.5)] whitespace-nowrap">
                  🃏 进入 {phaseNotice}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Pot display with chips - always visible during a hand */}
      {hand && (
        <div data-pot-area className="flex items-center gap-3 px-3.5 py-3 bg-gradient-to-r from-yellow-900/30 to-amber-900/20 border border-yellow-700/40 rounded-xl mb-[30px]" style={{ height: 56, overflow: 'hidden' }}>
          <div className="flex items-baseline gap-2 flex-shrink-0">
            <span className="text-xl font-bold text-yellow-400">底池</span>
            <span className="text-lg font-bold text-yellow-300">{hand.pot}</span>
          </div>
          {hand.pot > 0 && (
            <div data-pot-chips className="flex-1 flex justify-end overflow-x-auto">
              <PotChipDisplay playerBets={seatedPlayers.map(p => p.total_bet_this_hand)} size={26} />
            </div>
          )}
        </div>
      )}

      {/* Player list header */}
      <div className="text-sm font-semibold text-slate-400 mb-2 flex justify-between">
        <span>玩家列表</span>
        <span className="text-xs">{orderedPlayers.length} 人在局</span>
      </div>

      {/* Player rows - grid layout for more players */}
      <div className="grid grid-cols-2 gap-2" style={{ overflow: 'hidden' }}>
        <AnimatePresence initial={false}>
          {orderedPlayers
            .map(p => (
              <motion.div
                key={p.id}
                layout
                initial={false}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
              >
                <PlayerRow
                  player={p}
                  room={room}
                  playerId={playerId}
                  hand={hand}
                />
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

interface PlayerRowProps {
  player: Player;
  room: Room;
  playerId: string;
  hand: HandState | null;
}

function PlayerRow({ player: p, room, playerId, hand }: PlayerRowProps) {
  const isMe = p.id === playerId;
  const isCurrentTurn = hand?.current_player_id === p.id;
  const isFolded = p.status === 'folded';
  const isAllIn = p.status === 'all_in';
  const role = getRoleLabel(room, p.seat);
  const actionInfo = formatAction(p.last_action);

  // All-in push animation state
  const prevActionRef = useRef<string | null>(null);
  const [showAllInPush, setShowAllInPush] = useState(false);

  useEffect(() => {
    const prev = prevActionRef.current;
    const curr = p.last_action;
    if (curr && curr.startsWith('all_in:') && (!prev || !prev.startsWith('all_in:'))) {
      setShowAllInPush(true);
      const timer = setTimeout(() => setShowAllInPush(false), 3200);
      return () => clearTimeout(timer);
    }
    prevActionRef.current = curr;
  }, [p.last_action]);

  // Generate chips for all-in animation
  const allInChips = React.useMemo(() => {
    if (!showAllInPush) return [];
    const amount = p.last_action ? parseInt(p.last_action.split(':')[1]) || 0 : 0;
    const chips = decomposeChips(amount > 0 ? amount : p.current_bet);
    const items: { denom: ChipDenom; key: string; delay: number; offsetY: number }[] = [];
    let idx = 0;
    chips.forEach(({ denom, count }) => {
      for (let i = 0; i < Math.min(count, 3) && items.length < 12; i++) {
        items.push({
          denom,
          key: `${denom}-${i}`,
          delay: idx * 0.09,
          offsetY: (Math.random() - 0.5) * 24,
        });
        idx++;
      }
    });
    return items;
  }, [showAllInPush, p.last_action, p.current_bet]);

  return (
    <div
      data-player-id={p.id}
      className={`relative flex flex-col gap-1.5 px-2.5 py-2 rounded-xl border transition-all overflow-hidden ${
        isCurrentTurn
          ? 'border-yellow-400 bg-yellow-900/20 shadow-md shadow-yellow-900/30'
          : isMe
          ? 'border-blue-500/60 bg-slate-800/80'
          : 'border-slate-700/50 bg-slate-800/60'
      }`}
    >
      {/* Top row: Emoji + Name + Role */}
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="relative flex-shrink-0">
          <span className="text-xl">{p.emoji}</span>
          <span className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-slate-800 ${p.is_connected ? 'bg-green-400' : 'bg-red-500'}`} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">#{p.seat + 1}</span>
            <span className="text-xs font-medium truncate">{p.name}</span>
            {isMe && <span className="text-[9px] text-blue-400 flex-shrink-0">(我)</span>}
          </div>
          {role && (
            <span className={`text-[9px] font-bold px-1 py-0.5 rounded w-max mt-0.5 ${getRoleBadgeColor(role)}`}>
              {role}
            </span>
          )}
        </div>
      </div>

      {/* Bottom row: Chips and Action/Bet info */}
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[11px] text-green-400 font-semibold">💰 {p.chips}</span>
        
        <div className="flex items-center gap-1.5">
          {isCurrentTurn ? (
            <span className="text-[10px] font-bold text-yellow-400 animate-pulse">⏳ 行动</span>
          ) : actionInfo ? (
            <span className={`text-[10px] font-bold ${actionInfo.color}`}>{actionInfo.text}</span>
          ) : isAllIn ? (
            <span className="text-[10px] font-bold text-red-500">All-In</span>
          ) : hand && p.current_bet > 0 && !showAllInPush ? (
            <div className="flex items-center gap-0.5">
              <span className="text-[10px] font-bold text-orange-400">{p.current_bet}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* All-in push chips - fixed overlay to avoid overflow clipping */}
      <AnimatePresence>
        {showAllInPush && allInChips.length > 0 && (() => {
          const el = document.querySelector(`[data-player-id="${p.id}"]`);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return (
            <motion.div
              className="fixed pointer-events-none z-[200]"
              style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {allInChips.map((chip) => (
                <motion.img
                  key={chip.key}
                  src={`/poker_chip/chip_${chip.denom}.svg`}
                  alt={`${chip.denom}`}
                  className="absolute w-8 h-8 drop-shadow-lg"
                  style={{ top: '50%' }}
                  initial={{
                    right: 12,
                    y: chip.offsetY - 12,
                    opacity: 1,
                    scale: 0.8,
                  }}
                  animate={{
                    right: [12, 100, 240],
                    y: chip.offsetY - 12,
                    opacity: [0, 1, 1, 0],
                    scale: [0.8, 1.1, 0.9],
                  }}
                  transition={{
                    duration: 2.4,
                    delay: chip.delay,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                />
              ))}
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
