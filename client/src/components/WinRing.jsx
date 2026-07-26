import { useEffect, useState } from 'react';

export default function WinRing({ pct }) {
  const R = 62, C = 2 * Math.PI * R;
  const [offset, setOffset] = useState(C);
  useEffect(() => {
    const id = setTimeout(() => setOffset(C * (1 - (pct || 0) / 100)), 120);
    return () => clearTimeout(id);
  }, [pct, C]);

  return (
    <div className="ring-wrap">
      <svg width="150" height="150" viewBox="0 0 150 150">
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2e6b00" />
            <stop offset="60%" stopColor="#6FFF00" />
            <stop offset="100%" stopColor="#D4FF00" />
          </linearGradient>
        </defs>
        <circle className="ring-bg" cx="75" cy="75" r={R} fill="none" strokeWidth="11" />
        <circle className="ring-fg" cx="75" cy="75" r={R} fill="none" strokeWidth="11"
          strokeDasharray={C} strokeDashoffset={offset} />
      </svg>
      <div className="ring-center">
        <div className="pct">{(pct || 0).toFixed(0)}%</div>
        <div className="cap">Win rate</div>
      </div>
    </div>
  );
}
