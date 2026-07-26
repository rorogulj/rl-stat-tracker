import { useEffect, useRef } from 'react';
import { drawField2D } from '../field.js';

const ROLES = [
  ['front', '1st man', '#f09a52'],
  ['mid', '2nd man', '#a78bfa'],
  ['back', 'Last man', '#6FFF00'],
];

/**
 * Rotation map: average position when you're the first / middle / last player,
 * with rotation loop arrows (1st → last → 2nd → 1st). Own goal at the bottom.
 */
export default function RotationMap({ rolePos, width = 300 }) {
  const ref = useRef(null);
  const H = Math.round(width * 1.32);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !rolePos) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = 16, padY = 36;
    const fw = width - pad * 2, fh = H - padY * 2;
    const toX = (wx) => pad + ((wx + 4096) / 8192) * fw;
    const toY = (wy) => padY + (1 - (wy + 5120) / 10240) * fh;

    ctx.fillStyle = '#071033';
    ctx.beginPath(); ctx.roundRect(0, 0, width, H, 14); ctx.fill();
    drawField2D(ctx, toX, toY, { flip: false, pads: false });

    const pts = ROLES.filter(([k]) => rolePos[k]).map(([k, label, color]) => ({
      k, label, color, cx: toX(rolePos[k].x), cy: toY(rolePos[k].y), pct: rolePos[k].pct,
    }));
    if (pts.length < 2) return;

    // rotation loop arrows: 1st man → last man → (2nd) → 1st man
    const order = ['front', 'back', 'mid'].filter((k) => pts.some((p) => p.k === k));
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 1.6;
    for (let i = 0; i < order.length; i++) {
      const a = pts.find((p) => p.k === order[i]);
      const b = pts.find((p) => p.k === order[(i + 1) % order.length]);
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      const len = Math.hypot(dx, dy);
      if (len < 20) continue;
      const ux = dx / len, uy = dy / len;
      // curve slightly via a perpendicular offset
      const mx = (a.cx + b.cx) / 2 - uy * 22, my = (a.cy + b.cy) / 2 + ux * 22;
      ctx.strokeStyle = 'rgba(180,180,192,0.45)';
      ctx.beginPath();
      ctx.moveTo(a.cx + ux * 16, a.cy + uy * 16);
      ctx.quadraticCurveTo(mx, my, b.cx - ux * 18, b.cy - uy * 18);
      ctx.stroke();
      // arrowhead
      const ex = b.cx - ux * 18, ey = b.cy - uy * 18;
      const ang = Math.atan2(ey - my, ex - mx);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.45) * 9, ey - Math.sin(ang - 0.45) * 9);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang + 0.45) * 9, ey - Math.sin(ang + 0.45) * 9);
      ctx.stroke();
      ctx.setLineDash([7, 6]);
    }
    ctx.setLineDash([]);

    // role dots (radius by share of time in the role)
    for (const p of pts) {
      const r = 9 + (p.pct / 100) * 14;
      ctx.beginPath(); ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + '33'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = p.color; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.cx, p.cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.fill();
    }
  }, [rolePos, width, H]);

  if (!rolePos) return null;
  return (
    <div style={{ textAlign: 'center' }}>
      <canvas ref={ref} style={{ width, height: H }} />
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        {ROLES.filter(([k]) => rolePos[k]).map(([k, label, color]) => (
          <span key={k} style={{ fontSize: 11.5, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' }} />
            {label} · {rolePos[k].pct}%
          </span>
        ))}
      </div>
    </div>
  );
}
