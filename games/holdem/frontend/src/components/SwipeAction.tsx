import React, { useState, useRef } from 'react';

interface Props {
  onConfirm: () => void;
  children: React.ReactNode;
  className?: string;
  activeBg?: string;
}

export default function SwipeAction({ onConfirm, children, className = '', activeBg = 'bg-slate-800' }: Props) {
  const [offsetY, setOffsetY] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const startYRef = useRef<number | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    setIsActive(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (startYRef.current === null) return;
    const deltaY = e.clientY - startYRef.current;
    // Only allow swipe up
    if (deltaY < 0) {
      setOffsetY(Math.max(deltaY, -50)); // Max 50px up
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (startYRef.current === null) return;
    if (offsetY <= -40) { // Trigger distance
      onConfirm();
    }
    startYRef.current = null;
    setIsActive(false);
    setOffsetY(0);
  };

  return (
    <div className="relative w-full h-full" style={{ touchAction: 'none' }}>
      {/* Background container (revealed when swiping up) */}
      <div className={`absolute inset-0 rounded-xl border border-transparent flex items-start justify-center pt-1 transition-opacity ${isActive ? 'opacity-100 ' + activeBg : 'opacity-0'}`}>
        <span className="text-[10px] font-bold text-white/70 animate-bounce">↑ 上滑确认</span>
      </div>
      
      {/* The actual draggable button */}
      <button
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`absolute inset-0 w-full h-full flex flex-col items-center justify-center rounded-xl font-bold text-sm transition-transform ${className} ${!isActive ? 'duration-200 ease-out' : 'duration-0'}`}
        style={{
          transform: `translateY(${offsetY}px)`,
          touchAction: 'none'
        }}
      >
        {children}
      </button>
      
      {/* Invisible placeholder to maintain grid cell height if needed, 
          though ActionPanel grid sets the height based on others.
          We can just put a fixed py-2.5 to match others. */}
      <div className="invisible py-2.5">
        {children}
      </div>
    </div>
  );
}
