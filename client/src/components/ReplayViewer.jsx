import { useEffect, useRef, useState, useCallback } from 'react';
import { api, fmtDur } from '../api.js';
import { drawField2D } from '../field.js';

/**
 * 2D replay viewer — match animation from frame data (10 fps interpolated).
 * myTeam: orientation — your goal is always at the bottom (with a manual ⇅ toggle).
 */
export default function ReplayViewer({ matchId, goals = [], myTeam = 0 }) {
  const [tl, setTl] = useState(null);
  const [err, setErr] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [pos, setPos] = useState(0); // sample index (float)
  const [manualFlip, setManualFlip] = useState(false);
  const canvasRef = useRef(null);
  const stateRef = useRef({ pos: 0, playing: false, speed: 2, flip: false });
  const rafRef = useRef(null);

  useEffect(() => { api.timeline(matchId).then(setTl).catch(() => setErr(true)); }, [matchId]);

  stateRef.current.playing = playing;
  stateRef.current.speed = speed;
  // 180° rotation: team 1 defends +y → without the flip their goal would be at the top
  stateRef.current.flip = (myTeam === 1) !== manualFlip;

  // true field ratio 10240:8192 = 1.25 for the DRAWN area: horizontal padding is
  // `pad`, vertical is padY=54 inside draw() — the height must use the same numbers
  const W = 460, pad = 20, PAD_Y = 54;
  const H = PAD_Y * 2 + Math.round((W - pad * 2) * 1.25);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !tl) return;
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const samples = tl.samples;
    if (!samples.length) return;
    stateRef.current.pos = Math.max(0, Math.min(samples.length - 1, stateRef.current.pos));
    const i = Math.max(0, Math.min(samples.length - 1, Math.floor(stateRef.current.pos)));
    const frac = Math.min(1, stateRef.current.pos - i);
    const s0 = samples[i], s1 = samples[Math.min(samples.length - 1, i + 1)];
    const lerp = (a, b) => (a == null || b == null) ? a ?? b : a + (b - a) * frac;

    const padY = PAD_Y;
    const fw = W - pad * 2, fh = H - padY * 2;
    const flip = stateRef.current.flip;
    const cX = (wx) => { if (flip) wx = -wx; return pad + ((wx + 4096) / 8192) * fw; };
    const cY = (wy) => { if (flip) wy = -wy; return padY + (1 - (wy + 5120) / 10240) * fh; };

    // background + RL arena
    ctx.fillStyle = '#050d36';
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 14); ctx.fill();
    drawField2D(ctx, cX, cY, { flip, pads: true });

    // ball trail
    ctx.strokeStyle = 'rgba(216,180,254,0.35)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let k = Math.max(0, i - 25); k <= i; k++) {
      const b = samples[k];
      if (k === Math.max(0, i - 25)) ctx.moveTo(cX(b[1]), cY(b[2]));
      else ctx.lineTo(cX(b[1]), cY(b[2]));
    }
    ctx.stroke();

    // cars
    tl.players.forEach((p, pi) => {
      const off = 4 + pi * 5;
      const x = lerp(s0[off], s1[off]), y = lerp(s0[off + 1], s1[off + 1]);
      const yaw0 = s0[off + 3], boost = s0[off + 4];
      if (x == null || y == null) return; // demolished
      const cx = cX(x), cy = cY(y);
      const col = p.team === 0 ? '#55a3f5' : '#f09a52';
      // yaw: world angle → canvas (y inverted; flip = 180° rotation)
      const ang = -(yaw0 ?? 0) + Math.PI / 2 + (flip ? Math.PI : 0);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(-6.5, 7); ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
      // name + boost
      ctx.font = '600 11px "Cascadia Mono", Consolas, monospace';
      ctx.fillStyle = 'rgba(232,236,248,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, cx, cy - 14);
      if (boost != null) {
        ctx.fillStyle = 'rgba(10,15,30,0.75)';
        ctx.fillRect(cx - 13, cy + 10, 26, 4);
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(cx - 13, cy + 10, 26 * (boost / 100), 4);
      }
    });

    // ball
    const bx = lerp(s0[1], s1[1]), by = lerp(s0[2], s1[2]), bz = lerp(s0[3], s1[3]);
    const br = 5 + (bz / 2000) * 9; // bigger = higher
    ctx.beginPath(); ctx.arc(cX(bx), cY(by), br, 0, Math.PI * 2);
    ctx.fillStyle = '#f1f5f9'; ctx.shadowColor = '#d8b4fe'; ctx.shadowBlur = 14; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(120,150,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  }, [tl]);

  // animation loop
  useEffect(() => {
    if (!tl) return;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.max(0, (now - last) / 1000); last = now;
      if (stateRef.current.playing) {
        // samples are ~10 fps → 10 idx = 1 s of real time
        stateRef.current.pos += dt * 10 * stateRef.current.speed;
        if (stateRef.current.pos >= tl.samples.length - 1) {
          stateRef.current.pos = tl.samples.length - 1;
          setPlaying(false);
        }
        setPos(stateRef.current.pos);
      }
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tl, draw]);

  if (err) return <div className="empty"><h3>Timeline not available</h3><p>Run a re-import (Sync).</p></div>;
  if (!tl) return <div className="empty"><h3>Loading replay…</h3></div>;

  const samples = tl.samples;
  if (!samples.length) return <div className="empty"><h3>Timeline is empty</h3></div>;
  const i = Math.max(0, Math.min(samples.length - 1, Math.floor(pos)));
  const curT = samples[i][0];
  const score = goals.reduce((acc, g) => {
    if (g.time <= curT) acc[g.team]++;
    return acc;
  }, [0, 0]);

  const scrub = (e) => {
    const v = Number(e.target.value);
    stateRef.current.pos = v;
    setPos(v);
  };

  return (
    <div className="viewer card">
      <div className="viewer-head">
        <div className="viewer-score">
          <span style={{ color: '#55a3f5' }}>{score[0]}</span>
          <span style={{ color: '#4d5678', margin: '0 8px' }}>:</span>
          <span style={{ color: '#f09a52' }}>{score[1]}</span>
        </div>
        <div className="viewer-time">{fmtDur(curT - samples[0][0])} / {fmtDur(samples[samples.length - 1][0] - samples[0][0])}</div>
      </div>
      <canvas ref={canvasRef} style={{ width: W, height: H, display: 'block', margin: '0 auto' }} />
      <div className="viewer-controls">
        <button className="vc-btn" onClick={() => { stateRef.current.pos = 0; setPos(0); }}>⏮</button>
        <button className="vc-btn" onClick={() => setManualFlip(!manualFlip)} title="Flip field">⇅</button>
        <button className="vc-btn main" onClick={() => setPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
        {[1, 2, 4, 8].map((s) => (
          <button key={s} className={`vc-btn speed ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>{s}×</button>
        ))}
        <input type="range" min={0} max={samples.length - 1} step={0.5} value={pos} onChange={scrub} className="vc-scrub" />
      </div>
      <div className="viewer-goals">
        {goals.map((g, k) => (
          <button key={k} className={`vg t${g.team}`} title={g.player}
            onClick={() => {
              const idx = samples.findIndex((s) => s[0] >= g.time - 6);
              if (idx >= 0) { stateRef.current.pos = idx; setPos(idx); setPlaying(true); }
            }}>
            Goal {fmtDur(g.time)}
          </button>
        ))}
      </div>
    </div>
  );
}
