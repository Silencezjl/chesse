import React, { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface FlipCardProps {
  faceUp: boolean;
  frontSrc: string;
  backSrc: string;
  delay?: number;
  height?: number;
}

export default function FlipCard({ faceUp, frontSrc, backSrc, delay = 0, height = 40 }: FlipCardProps) {
  // Track whether this is a flip transition (not initial mount)
  const prevFaceUpRef = useRef(faceUp);
  const isInitialRender = useRef(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showGlow, setShowGlow] = useState(false);
  // Deferred rotateY: stays at old value until next frame so transition can animate
  const [targetRotateY, setTargetRotateY] = useState(faceUp ? 0 : 180);
  const glowTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      prevFaceUpRef.current = faceUp;
      return;
    }
    if (faceUp && !prevFaceUpRef.current) {
      // Card is flipping face-up: start animation, then update rotateY next frame
      setIsAnimating(true);
      setShowGlow(true);
      // Keep glow visible longer than the flip animation
      if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
      glowTimerRef.current = setTimeout(() => setShowGlow(false), 1800 + delay * 1000);
      requestAnimationFrame(() => {
        setTargetRotateY(0);
      });
    } else if (!faceUp && prevFaceUpRef.current) {
      // Card is flipping face-down (e.g. new hand)
      setTargetRotateY(180);
    } else {
      // Sync without animation
      setTargetRotateY(faceUp ? 0 : 180);
    }
    prevFaceUpRef.current = faceUp;
  }, [faceUp, delay]);

  return (
    <div style={{ perspective: 800 }} className="inline-block">
      <motion.div
        style={{ transformStyle: 'preserve-3d', position: 'relative', height }}
        animate={{
          rotateY: targetRotateY,
          scale: isAnimating ? [1, 1.35, 1] : 1,
        }}
        transition={
          isAnimating
            ? { duration: 0.9, delay, ease: [0.25, 0.46, 0.45, 0.94] }
            : { duration: 0 }
        }
        onAnimationComplete={() => setIsAnimating(false)}
      >
        {/* Front face */}
        <img
          src={frontSrc}
          alt="card"
          className={showGlow ? 'drop-shadow-[0_0_12px_rgba(99,102,241,0.8)]' : 'drop-shadow-sm'}
          style={{
            height,
            width: 'auto',
            backfaceVisibility: 'hidden',
            borderRadius: 4,
            transition: showGlow ? 'filter 0.3s' : 'filter 0.5s',
          }}
        />
        {/* Back face */}
        <img
          src={backSrc}
          alt="back"
          className="drop-shadow-sm"
          style={{
            height,
            width: 'auto',
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            position: 'absolute',
            top: 0,
            left: 0,
            borderRadius: 4,
          }}
        />
      </motion.div>
    </div>
  );
}
