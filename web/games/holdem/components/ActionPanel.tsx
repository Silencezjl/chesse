import {usePlatform} from '../../../platform/context';
import NameText from './NameText';
import React, { useState, useEffect } from 'react';
import { Room } from '../types';
import { snapToChip } from './ChipDisplay';

interface Props {
  room: Room;
  playerId: string;
  onAction: (action: string, amount?: number) => void;
  disabled?: boolean;
}

export default function ActionPanel({ room, playerId, onAction, disabled = false }: Props) {
  const platform = usePlatform();
  const [showRaise, setShowRaise] = useState(false);
  const [amount, setAmount] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const hand = room.hand;
  const player = room.players[playerId];
  // Any server update invalidates a pending confirmation and stale amounts.
  useEffect(() => { setConfirm(null); setShowRaise(false); }, [room, disabled]);
  useEffect(() => {
    const hide = () => { setConfirm(null); setShowRaise(false); };
    document.addEventListener('visibilitychange', hide);
    platform.signal.addEventListener('conceal', hide);
    return () => { document.removeEventListener('visibilitychange', hide); platform.signal.removeEventListener('conceal', hide); };
  }, []);
  if (!hand || !player) return null;
  if (player.status === 'folded' || player.status === 'all_in') {
    return <p className="text-center text-slate-300 py-2">{player.status === 'folded' ? '你已弃牌，可以继续观看本手' : '你已全下，等待本手结算'}</p>;
  }
  if (hand.current_player_id !== playerId) {
    return <p className="text-center text-slate-300 py-2">等待 <NameText value={room.players[hand.current_player_id || '']?.name || '其他玩家'} /> 行动</p>;
  }
  const currentBet = hand.current_bet;
  const call = Math.max(0, currentBet - player.current_bet);
  const max = player.chips + player.current_bet;
  const min = Math.min(snapToChip(currentBet + room.bb_amount), max);
  const quick = Array.from(new Set([min, snapToChip(currentBet + room.bb_amount * 2), snapToChip(currentBet + room.bb_amount * 3), snapToChip(currentBet + Math.floor(hand.pot / 2)), snapToChip(currentBet + hand.pot)])).filter(n => n >= min && n <= max);
  const submit = (type: string, value?: number) => { if (!disabled) { setConfirm(null); setShowRaise(false); onAction(type, value); } };
  if (confirm) return <div className="space-y-3" role="group" aria-label="确认操作">
    <p className="text-center text-white font-semibold">{confirm === 'fold' ? '确认弃牌？本手将无法继续行动。' : `确认全下？本手总投入将达到 ${max}。`}</p>
    <div className="grid grid-cols-2 gap-3"><button disabled={disabled} className="bg-slate-700 rounded-xl" onClick={() => setConfirm(null)}>先不操作</button><button disabled={disabled} className="bg-red-700 rounded-xl" onClick={() => submit(confirm, confirm === 'all_in' ? max : undefined)}>确认{confirm === 'fold' ? '弃牌' : '全下'}</button></div>
  </div>;
  if (showRaise) return <div className="space-y-3">
    <div className="flex justify-between items-center"><strong>加注到</strong><button className="text-slate-300" onClick={() => setShowRaise(false)}>取消</button></div>
    <label className="block"><span className="sr-only">加注总额</span><input className="w-full p-3 rounded-xl bg-slate-800 border border-slate-600 text-xl" type="number" inputMode="numeric" min={min} max={max} step={5} value={amount} onChange={e => setAmount(Number(e.target.value))} /></label>
    <p className="text-sm text-slate-300">额外投入 {Math.max(0, amount - player.current_bet)} · 最少加注到 {min}</p>
    <div className="flex flex-wrap gap-2">{[5, 10, 25, 50, 100, 500].map(n => <button key={n} disabled={amount + n > max} className="px-3 rounded-xl bg-slate-700" onClick={() => setAmount(amount + n)}>＋{n}</button>)}<button className="px-3 rounded-xl bg-slate-700" onClick={() => setAmount(Math.max(min, amount - 5))}>－5</button></div>
    <div className="flex gap-2 flex-wrap">{quick.map(n => <button key={n} className="px-3 rounded-xl bg-slate-700" onClick={() => setAmount(n)}>{n}</button>)}</div>
    <button className="w-full bg-blue-700 rounded-xl" disabled={disabled || !Number.isFinite(amount) || !Number.isInteger(amount) || amount < min || amount > max} onClick={() => amount === max ? setConfirm('all_in') : submit('raise', amount)}>确认加注到 {amount}</button>
  </div>;
  return <div className="space-y-2"><p className="text-sm text-green-300">轮到你了{disabled ? ' · 正在同步…' : ''}</p><div className="holdem-action-row" role="group" aria-label="下注操作">
    <button disabled={disabled} className="border border-red-800 bg-red-950 rounded-xl text-red-200" onClick={() => setConfirm('fold')}>弃牌</button>
    {call === 0 ? <button disabled={disabled} className="bg-slate-700 rounded-xl" onClick={() => submit('check')}>过牌</button> : call <= player.chips ? <button disabled={disabled} aria-label={`跟注 ${call}`} className="bg-green-800 rounded-xl" onClick={() => submit('call', call)}><span>跟注</span><small>{call}</small></button> : <button disabled aria-label="筹码不足，请全下" className="bg-slate-800 rounded-xl"><span>跟注</span><small>筹码不足</small></button>}
    <button disabled={disabled || player.chips <= call} className="bg-blue-800 rounded-xl" onClick={() => { setAmount(min); setShowRaise(true); }}>加注</button>
    <button disabled={disabled} aria-label={`全下 ${player.chips}`} className="bg-purple-800 rounded-xl" onClick={() => setConfirm('all_in')}><span>全下</span><small>{player.chips}</small></button>
  </div></div>;
}
