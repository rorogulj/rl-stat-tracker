import { useEffect, useRef, useState } from 'react';
import { drawField2D } from '../field.js';

/**
 * Shot map with xG: vertical field, Blue attacking up? No — world coordinates:
 * Blue (team 0) defends the bottom (-y) and shoots upward (+y), Orange the opposite.
 * Circle size = xG, filled circle = goal.
 */
export default function ShotMap({ players, width = 420 }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  // true field proportions: 10240/8192 = 1.25 (plus header/legend strip of 76 px)
  const pad = 18;
  const fwCalc = width - pad * 2;
  const H = Math.round(fwCalc * 1.25) + pad * 2 + 76;

  const shots = [];
  for (const p of players) {
    for (const s of (p.xg?.shots || [])) shots.push({ ...s, team: p.team, name: p.name });
  }

  const fw = width - pad * 2, fh = H - pad * 2 - 76;
  const toCanvas = (wx, wy) => [
    pad + ((wx + 4096) / 8192) * fw,
    pad + 38 + (1 - (wy + 5120) / 10240) * fh,
  ];

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#071033';
    ctx.beginPath(); ctx.roundRect(0, 0, width, H, 14); ctx.fill();

    // RL arena
    drawField2D(ctx, (wx) => toCanvas(wx, 0)[0], (wy) => toCanvas(0, wy)[1], { pads: false });

    // shots
    for (const s of shots) {
      const [cx, cy] = toCanvas(s.x, s.y);
      const r = 4 + s.xg * 20;
      const col = s.team === 0 ? '85,163,245' : '240,154,82';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (s.goal) {
        ctx.fillStyle = `rgba(${col},0.9)`; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(${col},0.22)`; ctx.fill();
        ctx.strokeStyle = `rgba(${col},0.8)`; ctx.lineWidth = 1.4; ctx.stroke();
      }
    }
  }, [players, width, H]);

  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = null, bd = 18;
    for (const s of shots) {
      const [cx, cy] = toCanvas(s.x, s.y);
      const d = Math.hypot(cx - mx, cy - my);
      if (d < bd) { bd = d; best = { ...s, cx, cy }; }
    }
    setHover(best);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas ref={ref} style={{ width, height: H, cursor: 'crosshair' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      {hover && (
        <div className="shot-tip" style={{ left: hover.cx + 12, top: hover.cy - 14 }}>
          <b>{hover.name}</b> · {hover.goal ? 'GOAL' : 'shot'}<br />
          xG {hover.xg.toFixed(2)}{hover.speed ? ` · ${Math.round(hover.speed / 27.78)} km/h` : ''}
        </div>
      )}
    </div>
  );
}
