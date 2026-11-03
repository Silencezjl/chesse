import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { decomposeChips, ChipDenom } from './ChipDisplay';

export interface WinInfo {
  playerId: string;
  playerEmoji: string;
  playerName: string;
  amount: number;
}

interface Props {
  winners: WinInfo[];
  potPosition: { x: number; y: number; width: number };
  durationMs?: number;
  onComplete: () => void;
}

interface ChipParticle {
  id: string;
  denom: ChipDenom;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  delay: number;
}

export default function WinChipsAnimation({ winners, potPosition, durationMs = 2000, onComplete }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onComplete, 600);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [onComplete, durationMs]);

  const particles = useMemo(() => {
    const result: ChipParticle[] = [];

    const potCenterX = potPosition.x;
    const potCenterY = potPosition.y;

    winners.forEach((winner) => {
      const playerEl = document.querySelector(`[data-player-id="${winner.playerId}"]`);
      if (!playerEl) return;
      const playerRect = playerEl.getBoundingClientRect();
      const targetX = playerRect.left + 24;
      const targetY = playerRect.top + playerRect.height / 2;

      const chips = decomposeChips(winner.amount);
      let idx = 0;

      chips.forEach(({ denom, count }) => {
        const showCount = Math.min(count, 4);
        for (let i = 0; i < showCount; i++) {
          const offsetX = (Math.random() - 0.5) * 40;
          const offsetY = (Math.random() - 0.5) * 30;
          result.push({
            id: `${winner.playerId}-${denom}-${i}`,
            denom,
            startX: potCenterX - 14 + offsetX,
            startY: potCenterY - 14 + offsetY,
            endX: targetX,
            endY: targetY - 14,
            delay: 0.3 + idx * 0.08,
          });
          idx++;
        }
      });
    });

    return result;
  }, [winners]);

  // Calculate winner announcement position - exactly cover the pot row (height 56px)
  const potRowHeight = 56;
  const announcementLeft = potPosition.x - potPosition.width / 2;
  const announcementWidth = potPosition.width;
  const announcementTop = potPosition.y - potRowHeight / 2;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[100] pointer-events-none"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Winner announcement - positioned at pot row */}
          <motion.div
            className="fixed z-[101]"
            style={{ left: announcementLeft, top: announcementTop, width: announcementWidth, height: potRowHeight }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'backOut' }}
          >
            <div className="flex items-center justify-center gap-3 px-3.5 h-full bg-gradient-to-r from-yellow-900/95 to-amber-900/90 backdrop-blur-sm border border-yellow-500/60 rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.3)]">
              <span className="text-xl font-bold text-yellow-400">🏆</span>
              <div className="flex items-center gap-3 flex-wrap justify-center">
                {winners.map((w) => (
                  <div key={w.playerId} className="flex items-center gap-1.5">
                    <span className="text-xl">{w.playerEmoji}</span>
                    <span className="text-white font-bold text-sm">{w.playerName}</span>
                    <span className="text-yellow-300 font-bold text-sm">+{w.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Animated chips */}
          {particles.map((p) => (
            <motion.img
              key={p.id}
              src={`/poker_chip/chip_${p.denom}.svg`}
              alt={`${p.denom}`}
              className="fixed w-14 h-14 drop-shadow-lg z-[200]"
              style={{ left: p.startX, top: p.startY }}
              initial={{
                left: p.startX,
                top: p.startY,
                opacity: 1,
                scale: 1.1,
              }}
              animate={{
                left: p.endX,
                top: p.endY,
                opacity: [1, 1, 1, 0],
                scale: [1.1, 0.75, 0.3, 0.1],
              }}
              transition={{
                duration: 1.6,
                delay: p.delay,
                ease: [0.4, 0, 0.2, 1],
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
