import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Room } from '../types';
import { snapToChip } from './ChipDisplay';

const CHIP_DENOMS = [500, 100, 50, 25, 10, 5] as const;

// ----------------------------------------------------------------------
// Swipe-to-confirm button component (local to ActionPanel for simplicity)
// ----------------------------------------------------------------------
function SwipeButton({
  onConfirm,
  children,
  className = '',
  disabled = false,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const startYRef = useRef<number | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || confirmed) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging || startYRef.current === null || confirmed) return;
    const deltaY = e.clientY - startYRef.current;
    // Allow dragging up (negative delta)
    if (deltaY < 0) {
      // max drag distance ~45px
      setOffsetY(Math.max(deltaY, -45));
    } else {
      setOffsetY(0);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging || confirmed) return;
    if (offsetY <= -35) { // threshold to trigger confirm
      setConfirmed(true);
      onConfirm();
    } else {
      // snap back
      setOffsetY(0);
    }
    setIsDragging(false);
    startYRef.current = null;
  };

  // Reset confirmed state if component re-renders (like when turn changes)
  useEffect(() => {
    setConfirmed(false);
    setOffsetY(0);
  }, [children]); // Reset if text changes

  return (
    <div className="relative w-full h-full min-h-[44px]" style={{ touchAction: 'none' }}>
      {/* Background hint track */}
      {!disabled && !confirmed && isDragging && (
        <div className="absolute inset-0 flex flex-col items-center justify-start pt-1.5 opacity-80 pointer-events-none">
          <span className="text-[10px] font-bold text-white tracking-widest">
            ↑ 上滑确认
          </span>
        </div>
      )}
      
      {/* Draggable Button */}
      <button
        ref={btnRef}
        disabled={disabled || confirmed}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`absolute inset-0 w-full h-full flex flex-col items-center justify-center ${className} ${
          isDragging ? 'duration-0' : 'transition-transform duration-200 ease-out'
        } ${confirmed ? 'opacity-50' : ''}`}
        style={{
          transform: `translateY(${offsetY}px)`,
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          zIndex: isDragging ? 10 : 1
        }}
      >
        {children}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------

interface Props {
  room: Room;
  playerId: string;
  onAction: (action: string, amount?: number) => void;
}

export default function ActionPanel({ room, playerId, onAction }: Props) {
  const [showRaise, setShowRaise] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);
  const [confirmAllIn, setConfirmAllIn] = useState(false);

  const hand = room.hand;
  const player = room.players[playerId];

  const bb = room.bb_amount;
  const currentBet = hand?.current_bet ?? 0;
  const myBet = player?.current_bet ?? 0;
  const myChips = player?.chips ?? 0;

  const quickRaises = useMemo(() => {
    if (!hand) return [];
    const pot = hand.pot;
    const items: { label: string; amount: number }[] = [];
    const twoBB = snapToChip(bb * 2 + currentBet);
    if (twoBB > currentBet && twoBB <= myChips + myBet) items.push({ label: '2BB', amount: twoBB });
    const threeBB = snapToChip(bb * 3 + currentBet);
    if (threeBB > currentBet && threeBB <= myChips + myBet) items.push({ label: '3BB', amount: threeBB });
    const halfPot = snapToChip(Math.floor(pot / 2) + currentBet);
    if (halfPot > currentBet && halfPot <= myChips + myBet) items.push({ label: '½ Pot', amount: halfPot });
    const fullPot = snapToChip(pot + currentBet);
    if (fullPot > currentBet && fullPot <= myChips + myBet) items.push({ label: 'Pot', amount: fullPot });
    return items;
  }, [hand, bb, currentBet, myChips, myBet]);

  // Auto-cancel all-in confirmation after 3 seconds
  useEffect(() => {
    if (!confirmAllIn) return;
    const timer = setTimeout(() => setConfirmAllIn(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmAllIn]);

  // Reset all-in confirmation when turn changes
  useEffect(() => {
    setConfirmAllIn(false);
  }, [hand?.current_player_id]);

  if (!hand || !player) return null;

  const isMyTurn = hand.current_player_id === playerId;
  const isFolded = player.status === 'folded';
  const isAllIn = player.status === 'all_in';
  const callAmount = currentBet - myBet;

  const canCheck = currentBet <= myBet;
  const canCall = callAmount > 0 && callAmount <= myChips;
  const minRaise = snapToChip(currentBet + bb);
  const maxRaise = myChips + myBet;
  const actualMinRaise = Math.min(minRaise, maxRaise);

  if (isFolded || isAllIn) {
    return (
      <div className="text-center py-1">
        <p className="text-slate-400 text-sm">
          {isFolded ? '你已弃牌 (Fold)' : `你已全押 (All-In) - 投入: ${player.current_bet}`}
        </p>
      </div>
    );
  }

  if (!isMyTurn) {
    return (
      <div className="text-center py-1">
        <span className="text-sm text-slate-400">等待其他玩家行动...</span>
      </div>
    );
  }

  if (showRaise) {
    const effectiveRaise = raiseAmount;
    const addChip = (d: number) => {
      const next = effectiveRaise + d;
      if (next <= maxRaise) setRaiseAmount(next);
    };
    const removeChip = (d: number) => {
      const next = effectiveRaise - d;
      if (next >= 0) setRaiseAmount(next);
    };

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">加注到</span>
          <button onClick={() => setShowRaise(false)} className="text-slate-400 hover:text-white text-sm">
            ✕ 取消
          </button>
        </div>

        {/* Current amount display */}
        <div className="text-center py-1">
          {effectiveRaise === 0 ? (
            <span className="text-base text-slate-400">请选择加注筹码</span>
          ) : (
            <div className="flex flex-col items-center">
              <div>
                <span className="text-2xl font-bold text-white">{effectiveRaise}</span>
                <span className="text-xs text-slate-400 ml-2">(额外投入 {Math.max(0, effectiveRaise - myBet)})</span>
              </div>
              <button onClick={() => setRaiseAmount(0)} className="text-[10px] text-slate-500 hover:text-slate-300 mt-0.5 px-2 py-0.5 rounded bg-slate-800">
                [清零]
              </button>
            </div>
          )}
        </div>

        {/* Chip buttons to add */}
        <div className="flex justify-center gap-1.5">
          {CHIP_DENOMS.map(d => {
            const canAdd = effectiveRaise + d <= maxRaise;
            return (
              <button
                key={d}
                onClick={() => addChip(d)}
                disabled={!canAdd}
                className="relative flex flex-col items-center disabled:opacity-30 transition active:scale-95"
              >
                <img
                  src={`/poker_chip/chip_${d}.svg`}
                  alt={`+${d}`}
                  className="w-11 h-11 drop-shadow-md"
                />
                <span className="text-[9px] text-green-400 font-bold mt-0.5">+{d}</span>
              </button>

            );
          })}
        </div>

        {/* Chip buttons to remove */}
        <div className="flex justify-center gap-1.5">
          {CHIP_DENOMS.map(d => {
            const canRemove = effectiveRaise - d >= 0;
            return (
              <button
                key={d}
                onClick={() => removeChip(d)}
                disabled={!canRemove}
                className="relative flex flex-col items-center disabled:opacity-30 transition active:scale-95"
              >
                <img
                  src={`/poker_chip/chip_${d}.svg`}
                  alt={`-${d}`}
                  className="w-8 h-8 drop-shadow-md opacity-60"
                />
                <span className="text-[9px] text-red-400 font-bold mt-0.5">-{d}</span>
              </button>
            );
          })}
        </div>

        {/* Quick raise presets */}
        {quickRaises.length > 0 && (
          <div className="flex gap-1.5 justify-center mt-1">
            {quickRaises.map(q => (
              <button
                key={q.label}
                onClick={() => setRaiseAmount(q.amount)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  effectiveRaise === q.amount
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {q.label} {q.amount}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => {
            onAction('raise', effectiveRaise);
            setShowRaise(false);
            setRaiseAmount(0);
          }}
          disabled={effectiveRaise < actualMinRaise}
          className="w-full mt-2 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {effectiveRaise === 0 
            ? '请先选择加注筹码' 
            : effectiveRaise < actualMinRaise 
              ? `至少需加注到 ${actualMinRaise}` 
              : `确认加注 → ${effectiveRaise}`}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Action buttons */}
      <div className="grid grid-cols-4 gap-1.5">
        <SwipeButton
          onConfirm={() => onAction('fold')}
          className="rounded-xl border font-bold text-sm transition bg-red-900/60 hover:bg-red-800 border-red-700 text-red-300"
        >
          Fold
        </SwipeButton>

        {canCheck ? (
          <button
            onClick={() => onAction('check')}
            className="py-2.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-xl text-white font-bold text-sm transition"
          >
            Check
          </button>
        ) : canCall ? (
          callAmount > 100 ? (
            <SwipeButton
              onConfirm={() => onAction('call', callAmount)}
              className="rounded-xl border font-bold text-sm transition bg-green-900/60 hover:bg-green-800 border-green-700 text-green-300"
            >
              Call {callAmount}
            </SwipeButton>
          ) : (
            <button
              onClick={() => onAction('call', callAmount)}
              className="py-2.5 bg-green-900/60 hover:bg-green-800 border border-green-700 rounded-xl text-green-300 font-bold text-sm transition"
            >
              Call {callAmount}
            </button>
          )
        ) : <div />}

        <button
          onClick={() => {
            setRaiseAmount(0);
            setShowRaise(true);
          }}
          disabled={myChips <= callAmount}
          className="py-2.5 bg-blue-900/60 hover:bg-blue-800 border border-blue-700 rounded-xl text-blue-300 font-bold text-sm transition disabled:opacity-40"
        >
          Raise
        </button>

        {confirmAllIn ? (
          <button
            onClick={() => {
              onAction('all_in', myChips + myBet);
              setConfirmAllIn(false);
            }}
            className="py-2.5 h-[44px] bg-red-700 hover:bg-red-600 border border-red-500 rounded-xl text-white font-bold text-sm transition animate-pulse"
          >
            确认All-In?
          </button>
        ) : (
          <button
            onClick={() => setConfirmAllIn(true)}
            className="py-2.5 h-[44px] bg-purple-900/60 hover:bg-purple-800 border border-purple-700 rounded-xl text-purple-300 font-bold text-sm transition"
          >
            All-In
          </button>
        )}
      </div>
    </div>
  );
}
