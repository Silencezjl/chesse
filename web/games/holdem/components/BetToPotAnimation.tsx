import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { decomposeChips, ChipDenom } from './ChipDisplay';

interface Props {
  amount: number;
  startPos: { x: number; y: number };
  endPos: { x: number; y: number };
  onComplete: () => void;
}

interface Particle {
  id: string;
  denom: ChipDenom;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  delay: number;
}

export default function BetToPotAnimation({ amount, startPos, endPos, onComplete }: Props) {
  const particles = useMemo(() => {
    const result: Particle[] = [];
    const chips = decomposeChips(amount);
    let idx = 0;
    for (const c of chips) {
      const showCount = Math.min(c.count, 3);
      for (let i = 0; i < showCount; i++) {
        const offsetX = (Math.random() - 0.5) * 20;
        const offsetY = (Math.random() - 0.5) * 10;
        result.push({
          id: `${c.denom}-${i}`,
          denom: c.denom,
          startX: startPos.x + offsetX,
          startY: startPos.y + offsetY,
          endX: endPos.x + (Math.random() - 0.5) * 30,
          endY: endPos.y,
          delay: idx * 0.06,
        });
        idx++;
      }
    }
    return result;
  }, [amount, startPos, endPos]);

  // Auto-complete after animation finishes
  React.useEffect(() => {
    const maxDelay = particles.length > 0 ? particles[particles.length - 1].delay : 0;
    const timer = setTimeout(onComplete, (maxDelay + 0.8) * 1000 + 200);
    return () => clearTimeout(timer);
  }, [particles, onComplete]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[150] pointer-events-none"
        initial={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {particles.map((p) => (
          <motion.img
            key={p.id}
            src={`/poker_chip/chip_${p.denom}.svg`}
            alt={`${p.denom}`}
            className="fixed w-8 h-8 drop-shadow-lg"
            style={{ left: p.startX - 16, top: p.startY - 16 }}
            initial={{
              left: p.startX - 16,
              top: p.startY - 16,
              opacity: 1,
              scale: 0.9,
            }}
            animate={{
              left: p.endX - 16,
              top: p.endY - 16,
              opacity: [1, 1, 0.8, 0],
              scale: [0.9, 0.7, 0.4],
            }}
            transition={{
              duration: 0.7,
              delay: p.delay,
              ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
            }}
          />
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
