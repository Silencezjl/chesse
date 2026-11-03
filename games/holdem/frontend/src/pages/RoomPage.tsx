import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { leaveRoom } from '../api';
import { Room } from '../types';
import SeatGrid from '../components/SeatGrid';
import PlayerCards from '../components/PlayerCards';
import ActionPanel from '../components/ActionPanel';
import SettlementPanel from '../components/SettlementPanel';
import WinChipsAnimation, { WinInfo } from '../components/WinChipsAnimation';
import MyChipStack from '../components/MyChipStack';
import BetToPotAnimation from '../components/BetToPotAnimation';
import FinalStandings from '../components/FinalStandings';
import { useWakeLock } from '../hooks/useWakeLock';
import { usePhaseSound } from '../hooks/usePhaseSound';
import { useRoomWebSocket } from '../hooks/useRoomWebSocket';

import RoomTopBar from '../components/RoomTopBar';
import BetweenHandsPanel from '../components/BetweenHandsPanel';
import FirstHandPanel from '../components/FirstHandPanel';

const PHASE_CN: Record<string, string> = {
  hand_start: '开始', preflop: '翻牌前', flop: '翻牌',
  turn: '转牌', river: '河牌', showdown: '摊牌', hand_end: '结束',
};

export default function RoomPage() {
  const { roomId: urlRoomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const {
    playerId, room, connected, latency, error,
    setRoomId, addEvent, standings, setStandings, phaseNotice, setPhaseNotice,
  } = useStore();
  const roomId = urlRoomId || null;
  useWakeLock();
  const { playPhaseSound } = usePhaseSound();
  
  const {
    send,
    winAnimPlayingRef,
    winAnimPlaying,
    setWinAnimPlaying,
    winAnimationData,
    setWinAnimationData,
    potPositionRef,
    winAnimPotPos,
    setWinAnimPotPos
  } = useRoomWebSocket(roomId);

  const prevPhaseRef = useRef<string | null>(null);
  const prevConnectionsRef = useRef<Record<string, boolean>>({});
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const countdownActive = useRef(false);

  const lastSettlementRef = useRef<{ potWinners: Record<string, string[]>; pots: { id: string; amount: number }[] } | null>(null);

  // Bet-to-pot animation state
  const [betAnim, setBetAnim] = useState<{ amount: number; startPos: { x: number; y: number }; endPos: { x: number; y: number } } | null>(null);

  const handleLeave = useCallback(async () => {
    if (roomId && playerId) {
      try { await leaveRoom(roomId, playerId); } catch {}
    }
    setRoomId(null);
    navigate('/');
  }, [roomId, playerId, setRoomId, navigate]);

  // Track settlement proposal for win animation
  useEffect(() => {
    const proposal = room?.hand?.settlement_proposal;
    const pots = room?.hand?.pots;
    if (proposal && pots && pots.length > 0) {
      lastSettlementRef.current = {
        potWinners: { ...proposal.pot_winners },
        pots: pots.map(p => ({ id: p.id, amount: p.amount })),
      };
    }
  }, [room?.hand?.settlement_proposal, room?.hand?.pots]);

  // Track pot element position continuously
  useEffect(() => {
    const potEl = document.querySelector('[data-pot-area]');
    if (potEl) {
      const rect = potEl.getBoundingClientRect();
      potPositionRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width };
    }
  });

  // Detect phase changes for notification + win animation
  useEffect(() => {
    const currentPhase = room?.hand?.phase ?? null;
    if (currentPhase && prevPhaseRef.current && currentPhase !== prevPhaseRef.current) {
      const cn = PHASE_CN[currentPhase] || currentPhase;
      setPhaseNotice(cn);
      setTimeout(() => setPhaseNotice(null), 2500);
      playPhaseSound(currentPhase);
    }

    // Detect player connection changes
    if (room?.players) {
      Object.values(room.players).forEach(p => {
        const wasConnected = prevConnectionsRef.current[p.id];
        if (wasConnected !== undefined && wasConnected !== p.is_connected) {
          if (!p.is_connected) {
            addEvent(`${p.name} 已掉线`);
          } else {
            addEvent(`${p.name} 已重新连接`);
          }
        }
        prevConnectionsRef.current[p.id] = p.is_connected;
      });
    }

    // Trigger win animation when leaving showdown
    if (prevPhaseRef.current === 'showdown' && currentPhase !== 'showdown' && lastSettlementRef.current) {
      const { potWinners, pots } = lastSettlementRef.current;
      const winMap = new Map<string, number>();
      for (const pot of pots) {
        const winners = potWinners[pot.id] || [];
        if (winners.length === 0) continue;
        const share = Math.floor(pot.amount / winners.length);
        for (const wid of winners) {
          winMap.set(wid, (winMap.get(wid) || 0) + share);
        }
      }
      const winInfos: WinInfo[] = [];
      winMap.forEach((amount, pid) => {
        const p = room?.players[pid];
        if (p) {
          winInfos.push({ playerId: pid, playerEmoji: p.emoji, playerName: p.name, amount });
        }
      });
      if (winInfos.length > 0) {
        // Block countdown immediately (ref for same-render, state for re-trigger)
        winAnimPlayingRef.current = true;
        setWinAnimPlaying(true);
        // Save pot position before it disappears from DOM
        const savedPos = potPositionRef.current || { x: window.innerWidth / 2, y: window.innerHeight / 3, width: window.innerWidth * 0.8 };
        setWinAnimPotPos(savedPos);
        // Small delay to let DOM update with new player positions
        setTimeout(() => setWinAnimationData(winInfos), 300);
      }
      lastSettlementRef.current = null;
    }

    prevPhaseRef.current = currentPhase;
  }, [room?.hand?.phase, setPhaseNotice, room?.players]);

  // Auto-start countdown after hand end
  useEffect(() => {
    if (!room || !playerId) return;
    const myPlayer = room.players[playerId];
    if (!myPlayer || myPlayer.seat < 0) return;

    // Block countdown while win animation is playing
    if (winAnimPlayingRef.current) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownActive.current = false;
      setCountdown(null);
      return;
    }

    const isWaiting = room.status === 'waiting';
    const handEnded = isWaiting && room.hand_number > 0;

    if (handEnded && !myPlayer.ready) {
      const needsRebuy = myPlayer.chips <= room.rebuy_minimum;
      const needsCashout = room.max_chips > 0 && myPlayer.chips > room.max_chips;
      if (needsRebuy || needsCashout) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownActive.current = false;
        setCountdown(null);
        return;
      }
      // Only start countdown if not already running
      if (countdownActive.current) return;
      countdownActive.current = true;
      const interval = room.hand_interval || 5;
      setCountdown(interval);
      let remaining = interval;
      countdownRef.current = setInterval(() => {
        remaining--;
        setCountdown(remaining);
        if (remaining <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownActive.current = false;
          // Auto-ready
          send({ type: 'ready' });
          setCountdown(null);
        }
      }, 1000);
    } else {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownActive.current = false;
      setCountdown(null);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownActive.current = false;
    };
  }, [room?.status, room?.hand_number, room?.players[playerId ?? '']?.ready, room?.players[playerId ?? '']?.chips, playerId, winAnimPlaying, send]);

  const handleSit = (seat: number) => send({ type: 'sit', seat });
  const handleStand = () => send({ type: 'stand' });
  const handleReady = () => send({ type: 'ready' });
  const handleAction = (action: string, amount?: number) => {
    // Trigger bet-to-pot animation for betting actions
    const betAmount = amount || 0;
    if (betAmount > 0 && ['call', 'raise', 'all_in'].includes(action)) {
      const chipStackEl = document.querySelector('[data-my-chip-stack]');
      const potChipsEl = document.querySelector('[data-pot-chips]') || document.querySelector('[data-pot-area]');
      if (chipStackEl && potChipsEl) {
        const chipRect = chipStackEl.getBoundingClientRect();
        const potRect = potChipsEl.getBoundingClientRect();
        setBetAnim({
          amount: betAmount,
          startPos: { x: chipRect.left + chipRect.width / 2, y: chipRect.top + chipRect.height / 2 },
          endPos: { x: potRect.left + potRect.width * 0.8, y: potRect.top + potRect.height / 2 },
        });
      }
    }
    send({ type: 'action', action, amount: betAmount });
  };
  const handlePropose = (potWinners: Record<string, string[]>) => {
    send({ type: 'propose_settle', pot_winners: potWinners });
  };
  const handleConfirm = () => send({ type: 'confirm_settle' });
  const handleReject = () => send({ type: 'reject_settle' });
  const handleRebuy = () => send({ type: 'rebuy' });
  const handleCashout = () => send({ type: 'cashout' });
  const handleEndGame = () => send({ type: 'end_game' });

  // Final standings screen
  if (standings) {
    return (
      <FinalStandings 
        standings={standings} 
        room={room} 
        onClose={() => { setStandings(null); setRoomId(null); navigate('/'); }} 
      />
    );
  }

  if (!room || !playerId) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <div className="text-center">
          <div className="animate-spin text-4xl mb-4">🃏</div>
          <p className="text-slate-400">连接房间中...</p>
        </div>
      </div>
    );
  }

  const myPlayer = room.players[playerId];
  const isWaiting = room.status === 'waiting';
  const isPlaying = room.status === 'playing';
  const isShowdown = room.hand?.phase === 'showdown';
  const isSeated = myPlayer?.seat >= 0;
  const isOwner = playerId === room.owner_id;
  const canRebuy = isWaiting && myPlayer && myPlayer.chips <= room.rebuy_minimum;
  const canCashout = isWaiting && myPlayer && room.max_chips > 0 && myPlayer.chips > room.max_chips;
  const firstHand = room.hand_number === 0;

  return (
    <div className="flex flex-col h-[100dvh] max-w-lg mx-auto overflow-hidden">
      {/* Top bar */}
      <RoomTopBar 
        roomId={room.id}
        handNumber={room.hand_number}
        sbAmount={room.sb_amount}
        bbAmount={room.bb_amount}
        connected={connected}
        latency={latency}
        isPlaying={isPlaying}
        onLeave={handleLeave}
      />

      {/* Error bar */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/60 border border-red-700 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {isWaiting && firstHand ? (
          <>
            <FirstHandPanel 
              room={room}
              playerId={playerId}
              isSeated={isSeated}
              canRebuy={canRebuy}
              onReady={handleReady}
              onRebuy={handleRebuy}
            />
            <SeatGrid room={room} playerId={playerId} onSit={handleSit} onStand={handleStand} />
          </>
        ) : isWaiting && !firstHand ? (
          <>
            {/* Between hands - auto countdown */}
            <PlayerCards room={room} playerId={playerId} phaseNotice={phaseNotice} />

            <BetweenHandsPanel 
              room={room}
              playerId={playerId}
              isOwner={isOwner}
              canRebuy={canRebuy}
              canCashout={canCashout}
              countdown={countdown}
              onRebuy={handleRebuy}
              onCashout={handleCashout}
              onEndGame={handleEndGame}
            />
          </>
        ) : (
          <>
            {/* Playing state */}
            <PlayerCards room={room} playerId={playerId} phaseNotice={phaseNotice} />

            {isShowdown && myPlayer?.status !== 'folded' ? (
              <SettlementPanel
                room={room}
                playerId={playerId}
                onPropose={handlePropose}
                onConfirm={handleConfirm}
                onReject={handleReject}
              />
            ) : isShowdown && myPlayer?.status === 'folded' ? (
              <div className="bg-slate-800 rounded-xl p-4 text-center">
                <p className="text-slate-400 text-sm">等待其他玩家完成结算...</p>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Bottom fixed area - my info + actions */}
      {isPlaying && myPlayer && !isShowdown && (
        <div className="flex-none z-10 bg-slate-900/95 backdrop-blur border-t border-slate-800 px-4 py-2">
          {/* My chips info */}
          <div className="flex items-center justify-between mb-2 text-sm">
            <span className="text-slate-400">
              {myPlayer.emoji} {myPlayer.name}
            </span>
            <div className="flex items-center gap-2">
              {myPlayer.total_rebuys > 0 && (
                <span className="text-[11px] text-orange-400">补码 {myPlayer.total_rebuys * room.initial_chips}</span>
              )}
              {myPlayer.total_cashouts > 0 && (
                <span className="text-[11px] text-purple-400">清码 {myPlayer.total_cashouts}</span>
              )}
              {myPlayer.current_bet > 0 && (
                <span className="text-[11px] text-yellow-400">已下注 {myPlayer.current_bet}</span>
              )}
              <span className="text-[11px] text-slate-400">后手</span>
              <span className="font-bold text-green-400 text-sm">{myPlayer.chips}</span>
              <MyChipStack amount={myPlayer.chips} size={28} />
            </div>
          </div>
          <ActionPanel room={room} playerId={playerId} onAction={handleAction} />
        </div>
      )}

      {/* Owner end game button during game (in between hands) */}
      {isPlaying && isOwner && !room.hand?.current_player_id && (
        <div className="px-4 pb-2">
          <button onClick={handleEndGame} className="w-full py-2 bg-red-900/40 hover:bg-red-800 border border-red-700/50 rounded-xl text-red-300 font-medium text-xs transition">
            结束游戏
          </button>
        </div>
      )}

      {/* Bottom fixed cashout/rebuy buttons for between-hands */}
      {isWaiting && !firstHand && myPlayer && (canCashout || canRebuy) && (
        <div className="flex-none z-10 bg-slate-900/95 backdrop-blur border-t border-slate-800 px-4 py-3">
          {canCashout && (
            <button onClick={handleCashout} className="w-full py-3 bg-purple-600 hover:bg-purple-700 rounded-xl text-white font-bold text-lg transition">
              清码 -{room.initial_chips} → 剩余 {myPlayer.chips - room.initial_chips}
            </button>
          )}
          {canRebuy && (
            <button onClick={handleRebuy} className="w-full py-3 bg-orange-600 hover:bg-orange-700 rounded-xl text-white font-bold text-lg transition">
              补码 → {room.initial_chips}
            </button>
          )}
        </div>
      )}

      {/* Bet-to-pot animation overlay */}
      {betAnim && (
        <BetToPotAnimation
          amount={betAnim.amount}
          startPos={betAnim.startPos}
          endPos={betAnim.endPos}
          onComplete={() => setBetAnim(null)}
        />
      )}

      {/* Win chips animation overlay */}
      {winAnimationData && (
        <WinChipsAnimation
          winners={winAnimationData}
          potPosition={winAnimPotPos || { x: window.innerWidth / 2, y: window.innerHeight / 3, width: window.innerWidth * 0.8 }}
          onComplete={() => {
            winAnimPlayingRef.current = false;
            setWinAnimPlaying(false);
            setWinAnimationData(null);
            setWinAnimPotPos(null);
          }}
        />
      )}
    </div>
  );
}
