import React from 'react';

interface Props {
  sb: number;
  setSb: (v: number) => void;
  initialChips: number;
  setInitialChips: (v: number) => void;
  rebuyMin: number;
  setRebuyMin: (v: number) => void;
  maxChips: number;
  setMaxChips: (v: number) => void;
  handInterval: number;
  setHandInterval: (v: number) => void;
  loading: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
}

export default function CreateRoomForm({
  sb, setSb,
  initialChips, setInitialChips,
  rebuyMin, setRebuyMin,
  maxChips, setMaxChips,
  handInterval, setHandInterval,
  loading, canSubmit, onSubmit
}: Props) {
  return (
    <div className="w-full bg-slate-800 rounded-xl p-4 space-y-4">
      <div>
        <label className="block text-sm text-slate-400 mb-1">小盲注 (SB)</label>
        <div className="flex gap-2 flex-wrap">
          {[5, 10, 25, 50, 100].map(v => (
            <button
              key={v}
              onClick={() => setSb(v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                sb === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1">大盲注 BB = {sb * 2}</p>
      </div>

      <div>
        <label className="block text-sm text-slate-400 mb-1">初始筹码</label>
        <div className="flex gap-2 flex-wrap">
          {[500, 1000, 2000, 5000, 10000].map(v => (
            <button
              key={v}
              onClick={() => setInitialChips(v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                initialChips === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm text-slate-400 mb-1">补码限额（筹码低于此值可补码，0=清零才能补）</label>
        <input
          type="number"
          className="w-full bg-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
          value={rebuyMin}
          onChange={e => setRebuyMin(Math.max(0, parseInt(e.target.value) || 0))}
          min={0}
        />
      </div>

      <div>
        <label className="block text-sm text-slate-400 mb-1">最高筹码量（超过后每手结算自动清码一次初始筹码，0=不限）</label>
        <input
          type="number"
          className="w-full bg-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
          value={maxChips}
          onChange={e => setMaxChips(Math.max(0, parseInt(e.target.value) || 0))}
          min={0}
          placeholder="0 表示不限制"
        />
        {maxChips > 0 && (
          <p className="text-xs text-slate-500 mt-1">超过 {maxChips} 筹码时，自动清码 {initialChips}</p>
        )}
      </div>

      <div>
        <label className="block text-sm text-slate-400 mb-1">每手间隔（秒）</label>
        <div className="flex gap-2 flex-wrap">
          {[3, 5, 8, 10, 15].map(v => (
            <button
              key={v}
              onClick={() => setHandInterval(v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                handInterval === v ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {v}s
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading || !canSubmit}
        className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 rounded-xl text-white font-bold text-lg transition"
      >
        {loading ? '创建中...' : '创建房间'}
      </button>
    </div>
  );
}
