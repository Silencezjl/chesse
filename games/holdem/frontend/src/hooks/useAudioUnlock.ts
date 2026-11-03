import { useEffect, useRef } from 'react';

export function useAudioUnlock() {
  const unlocked = useRef(false);

  useEffect(() => {
    const handleUnlock = () => {
      if (unlocked.current) return;
      
      // Unlock Web Speech API (iOS Safari requires this)
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(' '); // 空格字符
        utterance.volume = 0.01; // iOS 可能忽略 volume=0，使用极小音量
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.resume();
      }

      // Unlock Web Audio API
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        if (ctx.state === 'running') {
          ctx.close();
        }
      }

      unlocked.current = true;
      
      // Remove listeners once unlocked
      window.removeEventListener('touchstart', handleUnlock);
      window.removeEventListener('click', handleUnlock);
    };

    window.addEventListener('touchstart', handleUnlock, { once: true, passive: true });
    window.addEventListener('click', handleUnlock, { once: true, passive: true });

    return () => {
      window.removeEventListener('touchstart', handleUnlock);
      window.removeEventListener('click', handleUnlock);
    };
  }, []);
}
