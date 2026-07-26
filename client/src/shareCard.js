/**
 * Match share card: renders a PNG (1200×630) with the score, players+ratings
 * and key factors — for sharing on Discord etc. All local, canvas 2D.
 * downloadFullPage: the whole match page as one long PNG (html2canvas).
 */
import html2canvas from 'html2canvas-pro';
import { fmtDate, fmtDur } from './api.js';

/**
 * Prepare the page for capture: hide the navs, show the reveal sections and
 * TURN OFF animations/transitions/box-shadows — otherwise html2canvas serializes
 * elements with animation-delay at their initial keyframe (invisible), and draws
 * inset box-shadow (team card edges) as a full solid plane. Returns a cleanup function.
 */
function injectExportCss(extra = '') {
  const style = document.createElement('style');
  style.textContent = `
    .topbar, .subnav, .share-actions { display: none !important; }
    .reveal { opacity: 1 !important; transform: none !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; box-shadow: none !important; }
    body::before, body::after { display: none !important; } /* fixed ambient gradient — html2canvas draws it OVER the content */
    .factor-card.t0, .rank-chip.t0 { border-left: 3px solid #55a3f5 !important; }
    .factor-card.t1, .rank-chip.t1 { border-left: 3px solid #f09a52 !important; }
    /* liquid glass fallback: html2canvas doesn't know backdrop-filter or mask-composite borders,
       so glass surfaces get solid navy + a plain border */
    * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
    .card::before, .stat-card::before, .match-card::before, .factor-card::before,
    .hero::before, .scoreboard::before, .rank-mini::before, .compare-wrap::before,
    .topbar::before { content: none !important; }
    .card, .stat-card, .match-card, .factor-card, .hero, .scoreboard, .rank-mini,
    .session-est, .compare-wrap {
      background: #071033 !important;
      border: 1px solid rgba(239,244,255,0.14) !important;
    }
    ${extra}
  `;
  document.head.appendChild(style);
  for (const n of document.querySelectorAll('.reveal')) n.classList.add('in');
  return () => style.remove();
}

function downloadCanvas(canvas, name) {
  return new Promise((resolve) => canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    resolve();
  }, 'image/png'));
}

/** The whole page (without the sticky topbar/subnav) → one tall PNG. */
export async function downloadPagePng(filename) {
  const el = document.querySelector('.shell');
  if (!el) return;
  const cleanup = injectExportCss();
  await new Promise((r) => setTimeout(r, 250));
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: '#010828',
      scale: Math.min(1.4, 2400 / Math.max(1, el.scrollWidth)),
      useCORS: true,
      logging: false,
    });
    await downloadCanvas(canvas, filename);
  } finally {
    cleanup();
  }
}

export function downloadFullPage(m) {
  const d = (m.date || '').slice(0, 10);
  return downloadPagePng(`rl-match-summary-${d}-${m.team0_score}-${m.team1_score}.png`);
}

/** Any element (selector) → PNG. For ladder/archetype share (Reddit etc.).
 *  opts.settleMs: longer wait when extraCss changes the layout (recharts ResizeObserver reflow). */
export async function downloadElementPng(selector, name, opts = {}) {
  const el = document.querySelector(selector);
  if (!el) return;
  const cleanup = injectExportCss(opts.extraCss || '');
  await new Promise((r) => setTimeout(r, opts.settleMs ?? 250));
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: '#010828',
      scale: opts.scale ?? Math.min(1.5, 2400 / Math.max(1, el.scrollWidth)),
      useCORS: true,
      logging: false,
    });
    await downloadCanvas(canvas, name);
  } finally {
    cleanup();
  }
}

/**
 * Mobile version: the page temporarily narrows to 760px (everything into one column,
 * recharts adapts itself via ResizeObserver), gets captured into a 1520px-wide PNG
 * that reads on a phone without zooming, then the layout is restored.
 */
export async function downloadMobilePdf(m) {
  const el = document.querySelector('.shell');
  if (!el) return;
  const cleanup = injectExportCss(`
    .detail-grid, .rank-row, .coach-row, .top-grid, .sw-grid, .factor-grid { grid-template-columns: 1fr !important; }
    .scoreboard { grid-template-columns: 1fr !important; padding: 22px !important; gap: 14px !important; }
    .sb-score { justify-content: center; }
    .sb-meta { flex-wrap: wrap; }
    table.cmp { font-size: 10.5px !important; min-width: 0 !important; }
    .cmp th, .cmp td { padding: 4px 6px !important; }
    .ranks-table .rank-badge.sm { font-size: 10px !important; padding: 1px 5px 1px 3px !important; gap: 3px !important; }
    .ranks-table .rank-icon { width: 12px !important; height: 12px !important; }
    .viewer canvas, .heat-item canvas { max-width: 100% !important; height: auto !important; }
    .factor-detail { min-height: 0 !important; }
  `);
  const prevMax = el.style.maxWidth, prevPad = el.style.padding;
  el.style.maxWidth = '760px';
  el.style.padding = '0 14px 40px';
  await new Promise((r) => setTimeout(r, 1000)); // let recharts re-layout to the new width
  try {
    const canvas = await html2canvas(el, {
      backgroundColor: '#010828', scale: 2, useCORS: true, logging: false,
    });
    // PDF: one tall PNG is blurry on a phone (texture limit → downsampling),
    // so we slice the canvas into ~9:16 pages that every viewer renders sharp
    const { jsPDF } = await import('jspdf');
    const W = canvas.width, H = canvas.height;      // device px (scale 2)
    const pageH = Math.round(W * (16 / 9));
    const cssW = W / 2, cssPageH = pageH / 2;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [cssW, cssPageH], compress: true, hotfixes: ['px_scaling'] });
    for (let y = 0, page = 0; y < H; y += pageH, page++) {
      const slice = document.createElement('canvas');
      slice.width = W; slice.height = pageH;
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#010828';
      ctx.fillRect(0, 0, W, pageH);
      ctx.drawImage(canvas, 0, y, W, Math.min(pageH, H - y), 0, 0, W, Math.min(pageH, H - y));
      if (page > 0) pdf.addPage([cssW, cssPageH], 'portrait');
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, cssW, cssPageH);
    }
    const d = (m.date || '').slice(0, 10);
    pdf.save(`rl-match-mobile-${d}-${m.team0_score}-${m.team1_score}.pdf`);
  } finally {
    cleanup();
    el.style.maxWidth = prevMax;
    el.style.padding = prevPad;
  }
}

const BLUE = '#55a3f5', ORANGE = '#f09a52';

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function downloadMatchCard(m, factors) {
  // fontsource loads Anton onto the document, but canvas doesn't trigger it on its own — force load
  try { await document.fonts.load('400 110px Anton'); } catch { /* fallback stack */ }
  const W = 1200, H = 630;
  const cv = document.createElement('canvas');
  cv.width = W * 2; cv.height = H * 2;
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);

  // background
  ctx.fillStyle = '#010828';
  ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(180, 140, 0, 180, 140, 620);
  g.addColorStop(0, 'rgba(85,163,245,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W - 180, 140, 0, W - 180, 140, 620);
  g.addColorStop(0, 'rgba(240,154,82,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const font = (size, weight = 400) => { ctx.font = `${weight} ${size}px "Cascadia Mono", Consolas, monospace`; };
  const display = (size) => { ctx.font = `400 ${size}px Anton, "Arial Narrow", sans-serif`; };

  // header
  display(17);
  ctx.fillStyle = '#6FFF00';
  ctx.textAlign = 'left';
  ctx.fillText('● RL STAT TRACKER', 44, 52);
  font(14, 500);
  ctx.fillStyle = '#7e88ab';
  ctx.textAlign = 'right';
  const dur = m.meta?.totalSeconds || m.duration;
  ctx.fillText(`${m.map} · ${fmtDate(m.date)} · ${fmtDur(dur)} min · ${m.team_size}v${m.team_size}${m.overtime ? ' · OT' : ''}`, W - 44, 52);

  // score
  ctx.textAlign = 'center';
  display(110);
  ctx.fillStyle = BLUE; ctx.fillText(String(m.team0_score), W / 2 - 110, 190);
  ctx.fillStyle = '#2a3358'; display(64); ctx.fillText('–', W / 2, 178);
  ctx.fillStyle = ORANGE; display(110); ctx.fillText(String(m.team1_score), W / 2 + 110, 190);
  if (m.meta?.teamXg) {
    font(15, 500); ctx.fillStyle = '#7e88ab';
    ctx.fillText(`xG ${m.meta.teamXg[0].toFixed(2)} – ${m.meta.teamXg[1].toFixed(2)}`, W / 2, 222);
  }

  // teams + ratings
  const best = Math.max(...m.players.map((p) => p.gameScore ?? 0));
  const drawTeam = (players, x, color, align) => {
    ctx.textAlign = align;
    display(17); ctx.fillStyle = color;
    ctx.fillText(align === 'left' ? 'BLUE' : 'ORANGE', x, 118);
    let y = 150;
    for (const p of players) {
      font(17, 600); ctx.fillStyle = '#EFF4FF';
      const star = p.gameScore === best ? ' ★' : '';
      const label = `${p.name}${p.mvp ? ' (MVP)' : ''}`;
      const rating = p.gameScore != null ? `${p.gameScore}${star}` : '';
      if (align === 'left') {
        ctx.fillText(label, x, y);
        font(15, 700); ctx.fillStyle = p.gameScore >= 70 ? '#6FFF00' : p.gameScore >= 45 ? '#ffd166' : '#ff6d6d';
        ctx.fillText(rating, x + ctx.measureText(label).width + 60, y);
      } else {
        ctx.fillText(label, x, y);
        font(15, 700); ctx.fillStyle = p.gameScore >= 70 ? '#6FFF00' : p.gameScore >= 45 ? '#ffd166' : '#ff6d6d';
        ctx.fillText(rating, x - ctx.measureText(label).width - 60, y);
      }
      y += 30;
    }
  };
  const t0 = m.players.filter((p) => p.team === 0).sort((a, b) => (b.gameScore ?? 0) - (a.gameScore ?? 0));
  const t1 = m.players.filter((p) => p.team === 1).sort((a, b) => (b.gameScore ?? 0) - (a.gameScore ?? 0));
  drawTeam(t0, 44, BLUE, 'left');
  drawTeam(t1, W - 44, ORANGE, 'right');

  // key factors
  const facts = (factors || []).slice(0, 3);
  if (facts.length) {
    const winner = m.team0_score > m.team1_score ? 0 : 1;
    ctx.textAlign = 'left';
    display(16); ctx.fillStyle = '#b9c2dd';
    ctx.fillText(`WHY ${winner === 0 ? 'BLUE' : 'ORANGE'} WON`, 44, 306);
    const colW = (W - 88 - 2 * 24) / 3;
    facts.forEach((f, i) => {
      const x = 44 + i * (colW + 24), y0 = 330;
      // card
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath(); ctx.roundRect(x, y0, colW, 200, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = f.team === 0 ? BLUE : ORANGE;
      ctx.fillRect(x, y0 + 10, 3, 180);
      display(16);
      ctx.fillStyle = f.team === 0 ? BLUE : ORANGE;
      ctx.fillText(f.title, x + 18, y0 + 34);
      font(13.5, 400); ctx.fillStyle = '#b9c2dd';
      let ly = y0 + 60;
      for (const line of wrap(ctx, f.detail, colW - 36).slice(0, 6)) {
        ctx.fillText(line, x + 18, ly); ly += 20;
      }
      // impact meter
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 18, y0 + 178, colW - 36, 4);
      ctx.fillStyle = f.team === 0 ? BLUE : ORANGE;
      ctx.fillRect(x + 18, y0 + 178, (colW - 36) * (f.impact / 100), 4);
    });
  }

  // footer
  font(13, 500); ctx.fillStyle = '#4d5678'; ctx.textAlign = 'center';
  ctx.fillText('Generated locally by RL Stat Tracker — replay analysis, xG, component ratings', W / 2, H - 26);

  cv.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = (m.date || '').slice(0, 10);
    a.download = `rl-match-${d}-${m.team0_score}-${m.team1_score}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
