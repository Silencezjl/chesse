import React from 'react';

const CHIP_DENOMINATIONS = [500, 100, 50, 25, 10, 5] as const;

export type ChipDenom = typeof CHIP_DENOMINATIONS[number];

export function decomposeChips(amount: number): { denom: ChipDenom; count: number }[] {
  const result: { denom: ChipDenom; count: number }[] = [];
  let remaining = amount;
  for (const d of CHIP_DENOMINATIONS) {
    const count = Math.floor(remaining / d);
    if (count > 0) {
      result.push({ denom: d, count });
      remaining -= count * d;
    }
  }
  return result;
}

export function snapToChip(value: number): number {
  return Math.round(value / 5) * 5;
}

interface ChipDisplayProps {
  amount: number;
  size?: number; // px, default 24
  maxChips?: number; // max visible chip icons, default 8
}

export default function ChipDisplay({ amount, size = 24, maxChips = 8 }: ChipDisplayProps) {
  if (amount <= 0) return null;
  const chips = decomposeChips(amount);

  // Flatten to individual chip items, cap at maxChips
  const items: { denom: ChipDenom; key: string }[] = [];
  for (const c of chips) {
    for (let i = 0; i < c.count && items.length < maxChips; i++) {
      items.push({ denom: c.denom, key: `${c.denom}-${i}` });
    }
  }

  const totalChipCount = chips.reduce((s, c) => s + c.count, 0);
  const overflow = totalChipCount > maxChips;

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {items.map((item, idx) => (
        <img
          key={item.key}
          src={`/poker_chip/chip_${item.denom}.svg`}
          alt={`${item.denom}`}
          style={{ width: size, height: size, marginLeft: idx > 0 ? -size * 0.25 : 0 }}
          className="drop-shadow-sm"
        />
      ))}
      {overflow && <span className="text-[10px] text-slate-400 ml-0.5">...</span>}
    </div>
  );
}

interface ChipStackProps {
  amount: number;
  size?: number;
}

export function ChipStack({ amount, size = 28 }: ChipStackProps) {
  if (amount <= 0) return null;
  const chips = decomposeChips(amount);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map(c => (
        <div key={c.denom} className="flex items-center gap-0.5">
          <img
            src={`/poker_chip/chip_${c.denom}.svg`}
            alt={`${c.denom}`}
            style={{ width: size, height: size }}
            className="drop-shadow-sm"
          />
          {c.count > 1 && (
            <span className="text-xs font-bold text-slate-300">×{c.count}</span>
          )}
        </div>
      ))}
    </div>
  );
}

interface PotChipDisplayProps {
  playerBets: number[]; // each player's current_bet
  size?: number;
}

export function PotChipDisplay({ playerBets, size = 26 }: PotChipDisplayProps) {
  // Collect chips from each player individually (no merging)
  const allChips: ChipDenom[] = [];
  for (const bet of playerBets) {
    const chips = decomposeChips(bet);
    for (const c of chips) {
      for (let i = 0; i < c.count; i++) {
        allChips.push(c.denom);
      }
    }
  }
  if (allChips.length === 0) return null;

  // Group by denomination for stacked display
  const groups = new Map<ChipDenom, number>();
  for (const d of allChips) {
    groups.set(d, (groups.get(d) || 0) + 1);
  }

  // Sort by denomination descending
  const sorted = Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);

  return (
    <div className="flex items-end gap-2 flex-wrap">
      {sorted.map(([denom, count]) => (
        <div key={denom} className="flex flex-col items-center">
          {/* Stack chips vertically with overlap */}
          <div className="relative" style={{ height: size + Math.min(count - 1, 7) * 3, width: size }}>
            {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
              <img
                key={i}
                src={`/poker_chip/chip_${denom}.svg`}
                alt={`${denom}`}
                style={{
                  width: size,
                  height: size,
                  position: 'absolute',
                  bottom: i * 3,
                  left: 0,
                  zIndex: i,
                }}
                className="drop-shadow-sm"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
