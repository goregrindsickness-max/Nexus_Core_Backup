import React, { useState, useEffect } from 'react';

export const AnimatedCount: React.FC<{ value: number; prefix?: string; suffix?: string; className?: string }> = ({ value, prefix = '', suffix = '', className = '' }) => {
  const [displayValue, setDisplayValue] = React.useState(value);
  
 React.useEffect(() => {
  let start = displayValue;
  const end = value;
  if (start === end) return;

  const duration = 600; // ms
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let animationFrame: number;

  const updateCount = (now: number) => {
    try {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const current = Math.floor(start + (end - start) * progress);
      setDisplayValue(current);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(updateCount);
      }
    } catch (err) {
      // Fail silently to prevent taking down application thread
    }
  };

  animationFrame = requestAnimationFrame(updateCount);
  return () => cancelAnimationFrame(animationFrame);
}, [value]);
  
  return (
    <span className={className}>-
      {prefix}{displayValue.toLocaleString()}{suffix}
    </span>
  );
};

export const AnimatedText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  return (
    <span className={`inline-block animate-fade-in ${className}`}>
      {text}
    </span>
  );
};
