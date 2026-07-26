import { useEffect, useRef, useState } from 'react';

export default function CountUp({ value, decimals = 0, duration = 900, suffix = '' }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    const start = performance.now();
    const from = 0, to = Number(value) || 0;
    cancelAnimationFrame(raf.current);
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return <>{display.toFixed(decimals)}{suffix && <span className="unit">{suffix}</span>}</>;
}
