// Geometry of the standard RL arena (Soccar) in uu — shared by the 2D views.
export const FIELD = {
  X: 4096, Y: 5120, Z: 2044,
  CORNER: 1152,               // 45° beveled corners
  GOAL_HALF_W: 893, GOAL_H: 642, GOAL_DEPTH: 880,
};

// arena octagon (clockwise, starting from the bottom-left bevel)
export const OCTAGON = [
  [-FIELD.X, -FIELD.Y + FIELD.CORNER],
  [-FIELD.X + FIELD.CORNER, -FIELD.Y],
  [FIELD.X - FIELD.CORNER, -FIELD.Y],
  [FIELD.X, -FIELD.Y + FIELD.CORNER],
  [FIELD.X, FIELD.Y - FIELD.CORNER],
  [FIELD.X - FIELD.CORNER, FIELD.Y],
  [-FIELD.X + FIELD.CORNER, FIELD.Y],
  [-FIELD.X, FIELD.Y - FIELD.CORNER],
];

export const BIG_PADS = [
  [-3072, -4096], [3072, -4096], [-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096],
];

export const SMALL_PADS = [
  [0, -4240], [-1792, -4184], [1792, -4184], [-940, -3308], [940, -3308],
  [0, -2816], [-3584, -2484], [3584, -2484], [-1788, -2300], [1788, -2300],
  [-2048, -1036], [0, -1024], [2048, -1036], [-1024, 0], [1024, 0],
  [-2048, 1036], [0, 1024], [2048, 1036], [-1788, 2300], [1788, 2300],
  [-3584, 2484], [3584, 2484], [0, 2816], [-940, 3308], [940, 3308],
  [-1792, 4184], [1792, 4184], [0, 4240],
];

/**
 * Draw the RL field (top-down) on a canvas: octagon, midfield, boxes, recessed goals, boost pads.
 * toX/toY: world→canvas transforms (flip is handled inside them).
 */
export function drawField2D(ctx, toX, toY, { flip = false, pads = true, floor = true } = {}) {
  const path = () => {
    ctx.beginPath();
    OCTAGON.forEach(([x, y], i) => {
      const cx = toX(x), cy = toY(y);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.closePath();
  };

  // arena floor (floor=false when the lines are redrawn over a heatmap layer)
  if (floor) {
    path();
    ctx.fillStyle = '#081234';
    ctx.fill();
  }

  // recessed goals (behind the goal line)
  const goalLine = (yw, color) => {
    const y0 = toY(yw), y1 = toY(yw + Math.sign(yw) * FIELD.GOAL_DEPTH);
    const x0 = toX(-FIELD.GOAL_HALF_W), x1 = toX(FIELD.GOAL_HALF_W);
    ctx.fillStyle = 'rgba(10,14,26,0.9)';
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    // net mesh
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (let k = 1; k < 4; k++) {
      const xx = Math.min(x0, x1) + (Math.abs(x1 - x0) / 4) * k;
      ctx.beginPath(); ctx.moveTo(xx, Math.min(y0, y1)); ctx.lineTo(xx, Math.max(y0, y1)); ctx.stroke();
    }
    ctx.restore();
  };
  // world +y goal is Orange's — the coordinate transform (toY) already handles the
  // flip, so the colors must NOT be swapped too (that double-corrected them)
  goalLine(FIELD.Y, 'rgba(240,154,82,0.8)');
  goalLine(-FIELD.Y, 'rgba(85,163,245,0.8)');

  // field lines
  ctx.strokeStyle = 'rgba(160,185,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  path();
  ctx.stroke();

  // midfield line + center circle
  ctx.beginPath(); ctx.moveTo(toX(-FIELD.X), toY(0)); ctx.lineTo(toX(FIELD.X), toY(0)); ctx.stroke();
  const r = Math.abs(toX(1150) - toX(0));
  ctx.beginPath(); ctx.arc(toX(0), toY(0), r, 0, Math.PI * 2); ctx.stroke();

  // penalty boxes
  const box = (yw) => {
    const bw = Math.abs(toX(2496) - toX(-2496));
    const bh = Math.abs(toY(yw) - toY(yw - Math.sign(yw) * 1152));
    const bx = toX(-2496), by = Math.min(toY(yw), toY(yw - Math.sign(yw) * 1152));
    ctx.strokeRect(Math.min(bx, toX(2496)), by, bw, bh);
  };
  box(FIELD.Y); box(-FIELD.Y);

  // boost pads
  if (pads) {
    for (const [x, y] of SMALL_PADS) {
      ctx.beginPath(); ctx.arc(toX(x), toY(y), 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,209,102,0.4)'; ctx.fill();
    }
    for (const [x, y] of BIG_PADS) {
      ctx.beginPath(); ctx.arc(toX(x), toY(y), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,209,102,0.25)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,102,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
    }
  }
}

/** Clip region shaped like the arena (for heatmap layers). */
export function clipField(ctx, toX, toY) {
  ctx.beginPath();
  OCTAGON.forEach(([x, y], i) => {
    const cx = toX(x), cy = toY(y);
    if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
  });
  ctx.closePath();
  ctx.clip();
}
