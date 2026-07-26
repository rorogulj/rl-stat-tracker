import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceDot, ReferenceLine, CartesianGrid, ErrorBar,
} from 'recharts';
import { api } from '../api.js';
import { STAT_DEFS } from '../statDefs.js';
import { tierInfo } from '../tiers.js';
import RankBadge from '../components/RankBadge.jsx';
import { downloadElementPng } from '../shareCard.js';
import { BUCKET_COLORS, tooltipStyle as ttStyle } from '../theme.js';
import Scribble from '../components/Scribble.jsx';

// representative tier (0-22) of each bucket → icon /ranks/{n}.png
const BUCKET_TIER = {
  bronze: 2, silver: 5, gold: 8, platinum: 11, diamond: 14, champion: 17, 'grand-champion': 20, ssl: 22,
};

const ARCH_NAME = {
  Attack: 'Striker', Defense: 'Guardian', Rotation: 'Disciplined rotator',
  'Possession & duels': 'Possession playmaker', Boost: 'Boost economist', Movement: 'Speed & mechanics',
};

// symmetric duels: the league average is ~50% by definition (every win is someone's loss)
const SYMMETRIC_50 = new Set(['fiftyWinPct', 'kickoffWinPct']);

const tooltipStyle = ttStyle;

// Icons as data URIs: html2canvas serializes SVG without a base for relative URLs,
// so <image href="/ranks/..."> comes out empty in the PNG export. Downscaling to 48px keeps the strings small.
const iconCache = {};
function useRankIconData() {
  const [icons, setIcons] = useState({ ...iconCache });
  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.all(Object.entries(BUCKET_TIER).map(async ([bucket, idx]) => {
        if (iconCache[bucket]) return;
        try {
          const img = new Image();
          img.src = `/ranks/${idx}.png`;
          await img.decode();
          const cv = document.createElement('canvas');
          cv.width = 48; cv.height = 48;
          cv.getContext('2d').drawImage(img, 0, 0, 48, 48);
          iconCache[bucket] = cv.toDataURL('image/png');
        } catch { /* fallback: relative path */ }
      }));
      if (alive) setIcons({ ...iconCache });
    })();
    return () => { alive = false; };
  }, []);
  return icons;
}

/** X-axis tick = rank icon instead of text. */
function RankTick({ x, y, payload, icons }) {
  const idx = BUCKET_TIER[payload.value];
  if (idx == null) return null;
  const href = icons?.[payload.value] || `/ranks/${idx}.png`;
  return (
    <image href={href} xlinkHref={href} x={x - 9} y={y + 3} width={18} height={18} />
  );
}

function ArchetypeCard({ arch, totalPlayers, myTier }) {
  const cats = Object.entries(arch.cats);
  if (!cats.length) return null;
  const best = cats.reduce((a, b) => (b[1] > a[1] ? b : a));
  const worst = cats.reduce((a, b) => (b[1] < a[1] ? b : a));
  const spread = best[1] - worst[1];
  const title = spread < 1.5 ? 'Balanced all-rounder' : ARCH_NAME[best[0]] || best[0];

  return (
    <div className="card arch-card" style={{ padding: '20px 24px', marginBottom: 26 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Benchmark archetype — <span style={{ color: 'var(--accent)' }}>{title}</span></h3>
        <span className="footnote" style={{ margin: 0 }}>
          centroid model per stat category · {totalPlayers.toLocaleString('en-GB')} ballchasing players
        </span>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '10px 0 14px' }}>
        {spread < 1.5
          ? <>Every part of your game tracks close to <b>{tierInfo(arch.overall)?.name}</b> — no category stands out from the model&apos;s overall read.</>
          : <>Your <b>{best[0]}</b> looks like <b style={{ color: 'var(--accent)' }}>{tierInfo(best[1])?.name}</b> while
            your <b>{worst[0]}</b> tracks <b>{tierInfo(worst[1])?.name}</b> — overall the model reads you
            as <b>{tierInfo(arch.overall)?.name}</b>.</>}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--muted)' }}>Model estimate</span>
          <RankBadge tier={arch.overall} size="sm" estimate />
        </span>
        {myTier != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--muted)' }}>Current rank (tracker.gg)</span>
            <RankBadge tier={myTier} size="sm" />
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {cats.map(([cat, tier]) => {
          const d = Math.round((tier - arch.overall) * 10) / 10;
          return (
            <div key={cat} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              padding: '14px 10px', border: '1px solid var(--border)', borderRadius: 12,
              background: cat === best[0] ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent',
            }}>
              <span style={{ fontSize: 10.5, fontWeight: 650, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--muted)' }}>
                {cat}
              </span>
              <RankBadge tier={tier} size="sm" estimate />
              <span style={{ fontSize: 11, fontWeight: 650, color: d > 0.2 ? 'var(--green)' : d < -0.2 ? 'var(--red)' : 'var(--faint)' }}>
                {d > 0.2 ? `▲ +${d.toFixed(1)}` : d < -0.2 ? `▼ ${d.toFixed(1)}` : '— even'}
                {Math.abs(d) > 0.2 ? (Math.abs(d) >= 1.95 ? ' tiers' : ' tier') : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HelpCard({ data, effMode }) {
  const h = { fontSize: 11, fontWeight: 650, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 };
  const p = { color: 'var(--muted)', fontSize: 13, lineHeight: 1.55, margin: 0 };
  return (
    <div className="card" style={{ padding: '20px 24px', marginBottom: 22, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '18px 28px' }}>
      <div>
        <div style={h}>Where the data comes from</div>
        <p style={p}>
          A stratified sample of ranked replays downloaded from ballchasing.com — hundreds to over a thousand matches per rank
          bucket per playlist, all from the current season. Every replay is run through the same analyzer as your
          own games, so the numbers are directly comparable. This {effMode}v{effMode} ladder currently holds{' '}
          {data.totalPlayers.toLocaleString('en-GB')} player performances.
        </p>
      </div>
      <div>
        <div style={h}>How to read the charts</div>
        <p style={p}>
          The line is the average over all players of that rank; whiskers cover the middle 50% of them
          (25th–75th percentile) — that band shows how much single games vary even inside one rank.
          The <span style={{ color: 'var(--accent)' }}>◆ you</span> marker is your average across your own games
          in this mode, placed at your current tracker.gg rank. Hover any chart title for what exactly that stat measures.
        </p>
      </div>
      <div>
        <div style={h}>Scoreboard vs detected stats</div>
        <p style={p}>
          Goals, assists, saves and score come straight from the in-game scoreboard. Shots, clears, possession,
          duels, rotation flags and similar are detected from raw replay data using thresholds — absolute values
          can differ slightly from other sites, but every rank is measured the same way, so the rank-to-rank
          trend is what carries the signal.
        </p>
      </div>
      <div>
        <div style={h}>50/50s &amp; kickoffs</div>
        <p style={p}>
          Both players contesting a duel are scored, so the league average is ~50% by definition — the line is
          flat on purpose. What matters is how far <i>your</i> marker sits from the dashed 50% line.
          Shooting % is total goals ÷ total shots per rank, so games without a shot don&apos;t drag it down.
        </p>
      </div>
      <div>
        <div style={h}>Benchmark archetype</div>
        <p style={p}>
          For each stat category (Attack, Defense, Rotation…) the model measures how far your averages sit from
          the typical profile of every rank (z-distance to that rank&apos;s centroid over the category&apos;s stats) and
          blends the nearest ranks into a tier estimate. The overall estimate does the same over all ~34 stats.
          The archetype name is simply your strongest category; if all categories sit within ~1.5 tiers it
          becomes &quot;Balanced all-rounder&quot;. It recalculates from your latest games on every visit.
        </p>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={h}>For the technically minded — the math</div>
        <p style={{ ...p, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 }}>
          Charts: for stat x and rank bucket b, line = mean_b = (1/n_b)·Σx over all player-games in b;
          whiskers = [P25_b, P75_b] (per player-game). Exception shootingPct: line = Σgoals_b / Σshots_b
          (ratio of means). Rate stats normalise by ACTIVE time (goal replays &amp; kickoff pauses excluded).
          <br /><br />
          Tier estimate: your vector x̄ (per-stat mean over selected games) vs bucket centroids μ_b, σ_b:
          z_bk = (x̄_k − μ_bk) / max(σ_bk, 0.15·|μ_bk| + 0.3); d̄²_b = (1/K)·Σ_k min(9, z_bk²);
          softmax weights w_b = exp(−d̄²_b / 1.2); estimate t̂ = Σ w_b·t_b / Σ w_b with bucket tiers
          t_b ∈ {'{'}2, 5, 8, 11, 14, 17, 20, 22{'}'} (Bronze→SSL on the 0–22 tier scale).
          The σ floor stops near-constant stats from dominating; the z² cap limits single-stat outliers.
          Each stat&apos;s ⓘ shows its exact detection thresholds and denominator.
        </p>
      </div>
    </div>
  );
}

export default function RankLadder({ mode = '' }) {
  const effMode = mode === '1' || mode === '3' ? mode : '2'; // the ladder needs a concrete mode
  const [data, setData] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [rendering, setRendering] = useState(null);
  const [openDesc, setOpenDesc] = useState(null); // stat key whose description is open
  const icons = useRankIconData();

  useEffect(() => {
    setData(null);
    api.rankLadder(effMode).then(setData).catch(() => setData(false));
  }, [effMode]);

  if (data === null) return <div className="empty"><h3>Loading…</h3></div>;
  if (data === false) return <div className="empty"><h3>Server error</h3></div>;

  if (!data.buckets.length) {
    return (
      <div className="empty">
        <div className="big">⏳</div>
        <h3>Benchmark data is still downloading</h3>
        <p>
          The ballchasing download is filling rank buckets for {effMode}v{effMode} in the background.<br />
          Check the <b>Server</b> tab for progress — this page lights up as buckets reach 40+ players.
        </p>
      </div>
    );
  }

  const cats = [...new Set(STAT_DEFS.map((d) => d.cat))];
  const teamMode = effMode !== '1';

  const chartData = (def) => data.buckets.map((b) => {
    const s = b.stats[def.key];
    const mean = s?.mean ?? null;
    const p25 = s?.p25 ?? null;
    const p75 = s?.p75 ?? null;
    return {
      bucket: b.bucket,
      range: p25 != null && p75 != null ? [p25, p75] : null,
      mean,
      // whisker offsets from the mean (down/up), never negative
      err: mean != null && p25 != null && p75 != null
        ? [Math.max(0, mean - p25), Math.max(0, p75 - mean)]
        : null,
    };
  });

  return (
    <>
      <h2 className="section-title">Rank ladder — {effMode}v{effMode} <Scribble>climb</Scribble>
        <span className="sheet-note">
          how every stat scales from Bronze to SSL · {data.totalPlayers.toLocaleString('en-GB')} benchmark player-games (ballchasing)
          {data.myBucket && <> · you are <b style={{ color: BUCKET_COLORS[data.myBucket] }}>{data.myBucket}</b></>}
        </span>
      </h2>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="trn-refresh" onClick={() => setShowHelp((v) => !v)}
          title="What the data is, how the charts and the archetype model are calculated">
          ⓘ How this works
        </button>
        <span className="share-actions" style={{ display: 'flex', gap: 8 }}>
          {data.arch && (
            <button className="trn-refresh" disabled={!!rendering}
              title="Just the archetype card as a PNG — compact, ideal for Reddit/Discord"
              onClick={async () => {
                setRendering('arch');
                try { await downloadElementPng('.arch-card', `rl-archetype-${effMode}v${effMode}.png`); } finally { setRendering(null); }
              }}>
              {rendering === 'arch' ? 'Rendering…' : '⤓ Archetype PNG'}
            </button>
          )}
          <button className="trn-refresh" disabled={!!rendering}
            title="The whole ladder as one tall PNG, laid out narrow (2 chart columns) so text stays readable when Reddit/Discord scale it down"
            onClick={async () => {
              setRendering('full');
              try {
                // Reddit-friendly: temporarily narrow to 1120px (recharts reflows), capture at 1.8×
                await downloadElementPng('.shell', `rl-rank-ladder-${effMode}v${effMode}.png`, {
                  scale: 2,
                  settleMs: 1400,
                  extraCss: `
                    .shell { max-width: 1120px !important; padding: 8px 26px 40px !important; }
                    .ladder-grid { grid-template-columns: 1fr 1fr !important; }
                  `,
                });
              } finally { setRendering(null); }
            }}>
            {rendering === 'full' ? 'Rendering…' : '⤓ Full page PNG'}
          </button>
        </span>
      </div>

      {showHelp && <HelpCard data={data} effMode={effMode} />}

      {data.buckets.length < 8 && (
        <div className="card" style={{
          padding: '12px 18px', marginBottom: 18, fontSize: 13, color: 'var(--muted)',
          borderLeft: '3px solid var(--accent)',
        }}>
          <b style={{ color: 'var(--text, #e8e8ee)' }}>{8 - data.buckets.length} rank bucket{8 - data.buckets.length > 1 ? 's' : ''} missing.</b>{' '}
          The benchmark database is being built or re-imported in the background (this also happens after an
          analyzer update — all replays are re-analyzed). Charts fill in bucket by bucket as data returns;
          the <b>Server</b> tab shows live progress. Nothing is lost — no need to do anything.
        </div>
      )}

      {data.arch && <ArchetypeCard arch={data.arch} totalPlayers={data.totalPlayers} myTier={data.myTier} />}

      <div className="footnote" style={{ marginBottom: 14 }}>
        Line = average per rank · whiskers = middle 50% of players · <span style={{ color: 'var(--accent)' }}>◆</span> = your average
        ({data.myGames} games){data.buckets.length < 8 ? ` · ${8 - data.buckets.length} rank buckets still downloading` : ''}
      </div>

      {cats.map((cat) => {
        const defs = STAT_DEFS.filter((d) => d.cat === cat && (!d.teamOnly || teamMode));
        if (!defs.length) return null;
        return (
          <div key={cat}>
            <h3 className="dsection-h">{cat}</h3>
            <div className="ladder-grid">
              {defs.map((def) => {
                const cd = chartData(def);
                const myVal = data.me?.[def.key];
                // y-domain from the whiskers + my marker, with a little padding
                const nums = cd.flatMap((c) => [c.range?.[0], c.range?.[1], c.mean])
                  .concat([myVal]).filter((v) => v != null);
                const lo = Math.min(...nums), hi = Math.max(...nums);
                const pad = (hi - lo) * 0.08 || 0.5;
                return (
                  <div key={def.key} className="card chart-card" style={{ padding: 16 }}>
                    <h4 style={{ marginBottom: 8, cursor: def.desc ? 'pointer' : undefined, userSelect: 'none' }}
                      title={def.desc ? 'Click for explanation' : undefined}
                      onClick={() => def.desc && setOpenDesc(openDesc === def.key ? null : def.key)}>
                      {def.label}{def.invert ? ' ↓' : ''}
                      {def.desc && (
                        <span style={{
                          marginLeft: 6, fontSize: 11, fontWeight: 400,
                          color: openDesc === def.key ? 'var(--accent)' : 'var(--faint)',
                        }}>ⓘ</span>
                      )}
                    </h4>
                    {openDesc === def.key && (
                      <div style={{ margin: '0 0 10px' }}>
                        <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
                          {def.desc}
                        </p>
                        {def.math && (
                          <p style={{
                            fontSize: 11.5, lineHeight: 1.55, margin: '6px 0 0', color: 'var(--faint)',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                            borderLeft: '2px solid rgba(111,255,0,0.35)', paddingLeft: 8,
                          }}>
                            {def.math}
                          </p>
                        )}
                      </div>
                    )}
                    <ResponsiveContainer width="100%" height={158}>
                      <ComposedChart data={cd} margin={{ top: 6, right: 10, bottom: 0, left: -14 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="bucket" tick={<RankTick icons={icons} />} interval={0} height={26}
                          tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                        <YAxis tick={{ fill: '#7e88ab', fontSize: 10 }} tickLine={false} axisLine={false} width={44}
                          domain={[lo - pad, hi + pad]}
                          tickFormatter={(v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10)} />
                        <Tooltip contentStyle={tooltipStyle}
                          formatter={(v, n, item) => {
                            const r = item?.payload?.range;
                            const suf = def.suffix || '';
                            return [`${v}${suf}${r ? ` (mid 50%: ${r[0]}–${r[1]}${suf})` : ''}`, 'average'];
                          }}
                          labelFormatter={(l) => l} />
                        {SYMMETRIC_50.has(def.key) && (
                          <ReferenceLine y={50} stroke="rgba(255,255,255,0.22)" strokeDasharray="3 4"
                            label={{ value: '50% = league avg', position: 'insideTopRight', fill: '#8a8a99', fontSize: 9.5 }} />
                        )}
                        <Line dataKey="mean" stroke="#6FFF00" strokeWidth={2} dot={{ r: 2.5, fill: '#6FFF00' }} isAnimationActive={false}>
                          <ErrorBar dataKey="err" width={5} strokeWidth={1.3} stroke="rgba(140,178,255,0.45)" direction="y" />
                        </Line>
                        {myVal != null && data.myBucket && cd.some((c) => c.bucket === data.myBucket) && (
                          <ReferenceDot x={data.myBucket} y={myVal} r={5}
                            fill="var(--accent)" stroke="#010828" strokeWidth={2}
                            label={{ value: 'you', position: 'top', fill: '#b8ccff', fontSize: 10 }} />
                        )}
                        {myVal != null && (!data.myBucket || !cd.some((c) => c.bucket === data.myBucket)) && (
                          <ReferenceLine y={myVal} stroke="var(--accent)" strokeDasharray="5 4"
                            label={{ value: 'you', position: 'right', fill: '#b8ccff', fontSize: 10 }} />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
