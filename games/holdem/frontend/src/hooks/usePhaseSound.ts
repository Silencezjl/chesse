import { useCallback, useRef } from 'react';

type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'hand_end' | string;

function getAudioContext(): AudioContext | null {
  try {
    return new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return null;
  }
}

// Flop: 3 quick ascending card-deal ticks
function playFlop(ctx: AudioContext) {
  [0, 0.12, 0.24].forEach((offset, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600 + i * 120, ctx.currentTime + offset);
    osc.frequency.exponentialRampToValueAtTime(300 + i * 60, ctx.currentTime + offset + 0.08);
    gain.gain.setValueAtTime(0.25, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.1);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + 0.12);
  });
}

// Turn: single mid-tone "thud" with slight reverb feel
function playTurn(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);

  // subtle harmonic
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(880, ctx.currentTime);
  osc2.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
  gain2.gain.setValueAtTime(0.1, ctx.currentTime);
  gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc2.start(ctx.currentTime);
  osc2.stop(ctx.currentTime + 0.2);
}

// River: two-tone descending "whoosh"
function playRiver(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(800, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(400, ctx.currentTime + 0.05);
  osc2.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.3);
  gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.05);
  gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  osc2.start(ctx.currentTime + 0.05);
  osc2.stop(ctx.currentTime + 0.4);
}

// Showdown: dramatic ascending fanfare (3 notes)
function playShowdown(ctx: AudioContext) {
  const notes = [523, 659, 784]; // C5, E5, G5
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.13);
    gain.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.13);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + 0.25);
    osc.start(ctx.currentTime + i * 0.13);
    osc.stop(ctx.currentTime + i * 0.13 + 0.3);
  });
}

// Hand end: short descending "done" chime
function playHandEnd(ctx: AudioContext) {
  const notes = [784, 659, 523]; // G5, E5, C5
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
    gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.2);
    osc.start(ctx.currentTime + i * 0.1);
    osc.stop(ctx.currentTime + i * 0.1 + 0.25);
  });
}

export function usePhaseSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  const playPhaseSound = useCallback((phase: Phase) => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = getAudioContext();
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    // Resume if suspended (browser autoplay policy)
    const run = () => {
      switch (phase) {
        case 'flop':      playFlop(ctx); break;
        case 'turn':      playTurn(ctx); break;
        case 'river':     playRiver(ctx); break;
        case 'showdown':  playShowdown(ctx); break;
        case 'hand_end':  playHandEnd(ctx); break;
        default: break;
      }
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(run).catch(() => {});
    } else {
      run();
    }
  }, []);

  return { playPhaseSound };
}
