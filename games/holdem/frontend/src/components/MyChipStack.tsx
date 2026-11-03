import React, { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { decomposeChips, ChipDenom } from './ChipDisplay';

interface Props {
  amount: number;
  size?: number;
}

/**
 * Displays the player's chips as stacked chip images (grouped by denomination),
 * with two click animations: bounce and riffle shuffle.
 */
export default function MyChipStack({ amount, size = 22 }: Props) {
  const [animType, setAnimType] = useState<'none' | 'bounce' | 'riffle'>('none');
  const animating = useRef(false);

  const handleClick = useCallback(() => {
    if (animating.current) return;
    animating.current = true;
    const type = Math.random() < 0.5 ? 'bounce' : 'riffle';
    setAnimType(type);
    setTimeout(() => {
      setAnimType('none');
      animating.current = false;
    }, type === 'bounce' ? 800 : 1000);
  }, []);

  // Visual decomposition: favor smaller denominations to make stack look fuller
  if (amount <= 0) return null;

  const maxDisplay = 6;
  const overlap = 3; // px overlap between stacked chips

  // Build a visually appealing chip list: mix of denominations, biased toward smaller ones
  const displayChips: ChipDenom[] = [];
  const denomOptions: ChipDenom[] = [500, 100, 50, 25, 10, 5];
  let remaining = amount;

  // Use at most 1 of the largest denom, then spread the rest across smaller ones
  for (const d of denomOptions) {
    if (remaining <= 0 || displayChips.length >= maxDisplay) break;
    if (d >= 100) {
      // For large denoms, use at most 1
      if (remaining >= d) {
        displayChips.push(d);
        remaining -= d;
      }
    } else {
      // For smaller denoms, use more
      const maxUse = Math.min(Math.floor(remaining / d), maxDisplay - displayChips.length);
      for (let i = 0; i < maxUse; i++) {
        displayChips.push(d);
        remaining -= d;
      }
    }
  }
  // If we still have room and remaining, fill with smallest denom
  while (displayChips.length < maxDisplay && remaining >= 5) {
    displayChips.push(5);
    remaining -= 5;
  }
  // Reverse so smallest is at bottom, largest on top (visually nicer)
  displayChips.reverse();

  if (displayChips.length === 0) return null;
  const displayCount = displayChips.length;

  // Calculate bounce animation variants per chip
  const getBounceAnim = (pos: number) => {
    const bounceHeight = 12 + (displayCount - pos) * 3;
    const delay = pos * 0.03;
    return {
      animate: { y: [0, -bounceHeight, 0] },
      transition: {
        duration: 0.5,
        delay,
        ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
      },
    };
  };

  // Calculate riffle animation: split into left/right halves
  const getRiffleAnim = (pos: number) => {
    const half = Math.ceil(displayCount / 2);
    const isLeftHalf = pos < half;
    const shiftX = isLeftHalf ? -8 : 8;
    const liftY = -(6 + (pos % half) * 2);
    const delay = 0.05 * (pos % half);
    return {
      animate: {
        x: [0, shiftX, shiftX, 0],
        y: [0, liftY, liftY - 4, 0],
      },
      transition: {
        duration: 0.8,
        delay,
        ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
        times: [0, 0.3, 0.6, 1],
      },
    };
  };

  return (
    <div
      data-my-chip-stack
      className="flex items-center gap-1 cursor-pointer select-none"
      onClick={handleClick}
      title={`筹码: ${amount}`}
    >
      {/* Single mixed stack */}
      <div
        className="relative"
        style={{
          height: size + (displayCount - 1) * overlap,
          width: size,
        }}
      >
        {displayChips.map((denom, i) => {
          const anim =
            animType === 'bounce'
              ? getBounceAnim(i)
              : animType === 'riffle'
              ? getRiffleAnim(i)
              : null;

          return (
            <motion.img
              key={`${denom}-${i}`}
              src={`/poker_chip/chip_${denom}.svg`}
              alt={`${denom}`}
              className="absolute drop-shadow-sm"
              style={{
                width: size,
                height: size,
                bottom: i * overlap,
                left: 0,
                zIndex: i,
              }}
              animate={anim?.animate}
              transition={anim?.transition}
            />
          );
        })}
      </div>
    </div>
  );
}
