import { useEffect, useRef } from 'react';
import { drawField2D, clipField } from '../field.js';

/**
 * RL arena (vertical, own goal at the bottom) + heatmap / touch points.
 * grid: matrix [gy][gx] in world coordinates; flip for team 1 (goal at the bottom).
 */
export default function FieldHeatmap({ grid, flip = false, touchPoints = null, width = 300, accent = '#55a3f5' }) {
  const ref = useRef(null);
  const H = Math.round(width * 1.32);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = 16, padY = 36; // padY: room for the recessed goals
    const fw = width - pad * 2, fh = H - padY * 2;
    const toX = (wx) => { if (flip) wx = -wx; return pad + ((wx + 4096) / 8192) * fw; };
    const toY = (wy) => { if (flip) wy = -wy; return padY + (1 - (wy + 5120) / 10240) * fh; };

    // panel background
    ctx.fillStyle = '#071033';
    ctx.beginPath(); ctx.roundRect(0, 0, width, H, 14); ctx.fill();

    // arena (floor + goals + lines + pads)
    drawField2D(ctx, toX, toY, { flip, pads: !grid });

    // heatmap inside the arena shape
    if (grid && grid.length) {
      ctx.save();
      clipField(ctx, toX, toY);
      const gy = grid.length, gx = grid[0].length;
      let max = 0;
      for (const row of grid) for (const v of row) if (v > max) max = v;
      if (max > 0) {
        for (let y = 0; y < gy; y++) {
          for (let x = 0; x < gx; x++) {
            const v = grid[y][x];
            if (!v) continue;
            const t = Math.pow(v / max, 0.55);
            const wx = -4096 + ((x + 0.5) / gx) * 8192;
            const wy = -5120 + ((y + 0.5) / gy) * 10240;
            const cx = toX(wx), cy = toY(wy);
            const r = (fw / gx) * 1.35;
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, heatColor(t, Math.min(0.85, 0.12 + t * 0.8)));
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
          }
        }
      }
      ctx.restore();
      // lines over the heat (no floor so it doesn't cover the heat)
      drawField2D(ctx, toX, toY, { flip, pads: false, floor: false });
    }

    // touch points
    if (touchPoints && touchPoints.length) {
      ctx.fillStyle = accent;
      for (const [wx, wy] of touchPoints) {
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(toX(wx), toY(wy), 2.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }, [grid, flip, touchPoints, width, H, accent]);

  return <canvas ref={ref} style={{ width, height: H }} />;
}

/* ramp navy → neon → cream (on a navy background the warm blue/red ramps clashed with the theme) */
function heatColor(t, a) {
  const lerp = (x, y, k) => Math.round(x + (y - x) * k);
  let r, g, b;
  if (t < 0.5) { const k = t / 0.5; r = lerp(7, 111, k); g = lerp(16, 255, k); b = lerp(51, 0, k); }
  else { const k = (t - 0.5) / 0.5; r = lerp(111, 239, k); g = lerp(255, 244, k); b = lerp(0, 255, k); }
  return `rgba(${r},${g},${b},${a})`;
}
