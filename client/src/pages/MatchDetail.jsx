import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceDot, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import { api, fmtDate, fmtDur } from '../api.js';
import CompareTable from '../components/CompareTable.jsx';
import Scribble from '../components/Scribble.jsx';
import FieldHeatmap from '../components/FieldHeatmap.jsx';
import ShotMap from '../components/ShotMap.jsx';
import ReplayViewer from '../components/ReplayViewer.jsx';
import Replay3D from '../components/Replay3D.jsx';
import RankBadge from '../components/RankBadge.jsx';
import CountUp from '../components/CountUp.jsx';
import Reveal from '../components/Reveal.jsx';
import { tierName } from '../tiers.js';
import { matchFactors } from '../matchFactors.js';
import { downloadMatchCard, downloadFullPage, downloadMobilePdf } from '../shareCard.js';

const SECTIONS = [
  ['overview', 'Overview'],
  ['momentum', 'Momentum'],
  ['shots', 'Shots & xG'],
  ['replay', 'Replay'],
  ['duels', 'Duels'],
  ['boost', 'Boost'],
  ['movement', 'Movement'],
  ['positioning', 'Positioning'],
  ['possession', 'Possession'],
  ['heatmaps', 'Heatmaps'],
];

const tooltipStyle = {
  background: '#071033', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 10, fontSize: 13,
};

function SectionHead({ id, title, note }) {
  return (
    <h3 id={id} className="dsection-h dsection">
      {title}
      {note && <span className="sheet-note">{note}</span>}
    </h3>
  );
}

/**
 * Momentum series: who holds control throughout the match.
 * Combines smoothed field tilt (where the ball is played) with goal impulses that decay exponentially.
 * Positive = Blue in control, negative = Orange.
 */
function momentumSeries(tilt, goals) {
  if (!tilt || tilt.length < 4) return [];
  let ema = 0;
  return tilt.map(([t, y]) => {
    ema += 0.25 * (y - ema);
    let imp = 0;
    for (const g of goals) {
      // fieldTilt samples run on the ACTIVE clock — raw g.time lags by countdowns
      const gt = g.timeActive ?? g.time;
      if (gt <= t) imp += (g.team === 0 ? 1 : -1) * 0.9 * Math.exp(-(t - gt) / 25);
    }
    const v = Math.max(-1, Math.min(1, 0.62 * ema + 0.45 * imp));
    return { t, m: v, pos: Math.max(0, v), neg: Math.min(0, v) };
  });
}

const RADAR_KEYS = [
  ['attack', 'Attack'], ['defense', 'Defense'], ['possession', 'Possession'],
  ['boost', 'Boost'], ['pressure', 'Pressure'],
];

/** Rating component radar: selected player (pill) + everyone ranked by overall. */
function RatingRadar({ players, meKey }) {
  const rated = players.filter((p) => p.rating);
  const [sel, setSel] = useState(meKey);
  if (!rated.length) return null;
  const p = rated.find((x) => x.key === sel) || rated.find((x) => x.key === meKey) || rated[0];
  const data = RADAR_KEYS.map(([k, label]) => ({ k: label, v: p.rating[k] }));
  const color = p.team === 0 ? '#55a3f5' : '#f09a52';
  const sorted = [...rated].sort((a, b) => b.rating.overall - a.rating.overall);
  return (
    <div className="card keystat-card" style={{ marginTop: 18 }}>
      <div className="sheet-h">Rating breakdown</div>
      <div className="pill-select" style={{ justifyContent: 'flex-start' }}>
        {rated.map((x) => (
          <button key={x.key} className={`pill ${p.key === x.key ? `active t${x.team}` : ''}`} onClick={() => setSel(x.key)}>
            {x.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
        <ResponsiveContainer width="100%" height={240}>
          <RadarChart data={data} outerRadius="78%">
            <PolarGrid stroke="rgba(255,255,255,0.08)" />
            <PolarAngleAxis dataKey="k" tick={{ fill: '#7e88ab', fontSize: 11.5 }} />
            <PolarRadiusAxis domain={[0, 99]} tick={false} axisLine={false} />
            <Radar dataKey="v" stroke={color} fill={color} fillOpacity={0.22} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
        <div>
          {sorted.map((x, i) => (
            <div key={x.key} className="keystat" style={{ gridTemplateColumns: 'auto 1fr auto', gap: 10 }}>
              <span className="ks-avg">#{i + 1}</span>
              <span className="ks-label" style={{ color: x.team === 0 ? 'var(--blue)' : 'var(--orange)' }}>{x.name}</span>
              <span className={`rating-chip ${x.rating.overall >= 70 ? 'hi' : x.rating.overall >= 45 ? 'mid' : 'lo'}`}>
                {x.rating.overall}{i === 0 ? ' ★' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="footnote">Components normalized vs this lobby · clutch goals give a bonus</div>
    </div>
  );
}

/** Stats from this match that deviate most from the player's per-game average in the same mode. */
function KeyStats({ me, prof }) {
  if (!me || !prof) return null;
  const rows = [
    ['Goals', me.core.goals, prof.perGame.goals, 1],
    ['Assists', me.core.assists, prof.perGame.assists, 1],
    ['Saves', me.core.saves, prof.perGame.saves, 1],
    ['Shots', me.core.shots, prof.perGame.shots, 1],
    ['Score', me.core.score, prof.perGame.score, 0],
    ['Shooting %', me.core.shootingPct, prof.perGame.shootingPct, 1, '%'],
    ['xG', me.xg?.total, prof.xg?.xgPerGame, 2],
    ['Possession', me.possession.possessionPct, prof.averages.possessionPct, 1, '%'],
    ['Touches / min', me.possession.touchesPerMin, prof.averages.touchesPerMin, 1],
    ['Turnovers', me.possession.turnovers, prof.averages.turnovers, 1, '', true],
    ['Takeaways', me.possession.steals, prof.averages.steals, 1],
    ['50/50 win %', me.possession.fiftyWinPct, prof.averages.fiftyWinPct, 0, '%'],
    ['Kickoff win %', me.possession.kickoffWinPct, prof.averages.kickoffWinPct, 0, '%'],
    ['Average boost', me.boost.avgAmount, prof.averages.avgBoost, 1],
    ['Time at 0 boost', me.boost.pctZero, prof.averages.pctZeroBoost, 1, '%', true],
    ['Supersonic', me.movement.pctSupersonic, prof.averages.pctSupersonic, 1, '%'],
    ['Behind ball', me.positioning.pctBehindBall, prof.averages.pctBehindBall, 1, '%'],
    ['Demos', me.core.demosInflicted, prof.perGame.demos, 1],
  ];
  const scored = rows
    .filter(([, v, avg]) => v != null && avg != null)
    .map(([label, v, avg, dec, suffix = '', lowerBetter = false]) => {
      const rel = (v - avg) / Math.max(Math.abs(avg), 0.75); // 0.75 so tiny averages don't explode
      return { label, v, avg, dec, suffix, lowerBetter, rel, mag: Math.abs(rel) };
    })
    .sort((a, b) => b.mag - a.mag);
  const shown = scored.filter((s) => s.mag >= 0.2).slice(0, 7);
  const list = shown.length >= 3 ? shown : scored.slice(0, 3);
  if (!list.length) return null;

  return (
    <div className="card keystat-card">
      <div className="sheet-h">Key stats — vs your average</div>
      <div className="keystat-sub">Where this match stood out from your usual {prof.games}-game form</div>
      {list.map((s) => {
        const good = s.lowerBetter ? s.rel < 0 : s.rel > 0;
        const pct = Math.round(s.rel * 100);
        return (
          <div key={s.label} className="keystat">
            <span className="ks-label">{s.label}</span>
            <span className="ks-val">{Number(s.v).toFixed(s.dec)}{s.suffix}</span>
            <span className="ks-avg">avg {Number(s.avg).toFixed(s.dec)}{s.suffix}</span>
            <span className={`ks-delta ${good ? 'good' : 'bad'}`}>{pct > 0 ? '+' : ''}{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

export default function MatchDetail() {
  const { id } = useParams();
  const [m, setM] = useState(null);
  const [heatSel, setHeatSel] = useState(null);
  const [ranks, setRanks] = useState(null);
  const [ranksLoading, setRanksLoading] = useState(false);
  const [fetchMsg, setFetchMsg] = useState(null);
  const [view3d, setView3d] = useState(true);
  const [active, setActive] = useState('overview');
  const [myProf, setMyProf] = useState(null); // my average in this mode, for Key stats
  const [rendering, setRendering] = useState(null); // 'full' | 'mobile' | null — PNG export in progress
  const spyRef = useRef(null);

  useEffect(() => { api.match(id).then(setM).catch(() => setM(false)); }, [id]);

  useEffect(() => {
    if (!m || !m.me) return;
    api.profile(m.me, String(m.team_size)).then(setMyProf).catch(() => setMyProf(null));
  }, [m]);

  // scrollspy: highlight the section closest to the top of the viewport
  useEffect(() => {
    if (!m) return;
    const onScroll = () => {
      cancelAnimationFrame(spyRef.current);
      spyRef.current = requestAnimationFrame(() => {
        let best = SECTIONS[0][0], bestY = -Infinity;
        for (const [sid] of SECTIONS) {
          const el = document.getElementById(sid);
          if (!el) continue;
          const y = el.getBoundingClientRect().top;
          if (y <= 160 && y > bestY) { bestY = y; best = sid; }
        }
        setActive(best);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(spyRef.current); };
  }, [m]);

  const fetchRanks = async () => {
    setRanksLoading(true);
    setFetchMsg(null);
    const r = await api.matchRanks(id).catch(() => null);
    setRanks(r);
    setRanksLoading(false);
    if (!r) setFetchMsg({ ok: false, text: 'fetch failed — is the server running?' });
    else {
      const found = (r.players || []).filter((p) => p.ranks && Object.values(p.ranks).some((x) => x?.tier != null)).length;
      const total = (r.players || []).length;
      if (r.rateLimited && found < total) {
        setFetchMsg({ ok: false, text: `tracker.gg is rate-limiting requests — found ${found}/${total}, try again in ~20 min` });
      } else if (found === 0) {
        setFetchMsg({ ok: false, text: 'no tracker.gg profiles found for these players' });
      } else {
        setFetchMsg({ ok: true, text: `✓ ranks fetched for ${found} of ${total} players` });
      }
    }
  };

  // all of a player's ranks (1v1/2v2/3v3) — from a fresh fetch or the cache on m.players
  const allRanksOf = (p) => ranks?.players?.find((x) => x.key === p.key)?.ranks || p.realRanks || {};

  if (m === null) return <div className="empty"><h3>Loading…</h3></div>;
  if (m === false) return <div className="empty"><h3>Match not found</h3></div>;

  const t0 = m.players.filter((p) => p.team === 0).sort((a, b) => b.core.score - a.core.score);
  const t1 = m.players.filter((p) => p.team === 1).sort((a, b) => b.core.score - a.core.score);
  const bestRating = Math.max(...m.players.map((p) => p.gameScore ?? 0));
  const ratingCls = (v) => v == null ? '' : v >= 70 ? 'hi' : v >= 45 ? 'mid' : 'lo';
  const Lineup = ({ players }) => (
    <div className="players">
      {players.map((p) => (
        <div key={p.key} className="sb-player">
          <Link to={`/player/${encodeURIComponent(p.key)}`} className="sb-pname">{p.name}</Link>
          {p.gameScore != null && (
            <span className={`rating-chip ${ratingCls(p.gameScore)}`} title="Game rating (1–99) from overall match stats">
              {p.gameScore}{p.gameScore === bestRating ? ' ★' : ''}
            </span>
          )}
        </div>
      ))}
      {!players.length && '—'}
    </div>
  );
  const dur = m.meta?.totalSeconds || m.duration;
  const maxT = Math.max(dur, ...(m.meta?.goals || []).map((g) => g.time), 1);
  const tilt = (m.meta?.fieldTilt || []).map(([t, y]) => ({ t, y }));
  const heatPlayer = heatSel === 'ball' ? null : m.players.find((p) => p.key === heatSel) || m.players.find((p) => p.key === m.me) || m.players[0];
  const myTeam = m.players.find((p) => p.key === m.me)?.team ?? 0;

  return (
    <>
      <p style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link to="/matches" style={{ color: 'var(--accent)', fontSize: 13.5 }}>← Back to matches</Link>
        <span className="share-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="trn-refresh" onClick={() => downloadMatchCard(m, matchFactors(m))}
            title="Compact 1200×630 card — result, ratings, key factors">
            ⤓ Card PNG
          </button>
          <button className="trn-refresh" disabled={!!rendering}
            title="The entire match page as one tall PNG (desktop width)"
            onClick={async () => { setRendering('full'); try { await downloadFullPage(m); } finally { setRendering(null); } }}>
            {rendering === 'full' ? 'Rendering…' : '⤓ Full page PNG'}
          </button>
          <button className="trn-refresh" disabled={!!rendering}
            title="Single-column multi-page PDF — renders sharp on phones"
            onClick={async () => { setRendering('mobile'); try { await downloadMobilePdf(m); } finally { setRendering(null); } }}>
            {rendering === 'mobile' ? 'Rendering…' : '⤓ Mobile PDF'}
          </button>
        </span>
      </p>

      {/* SCOREBOARD */}
      <div className="scoreboard">
        <Scribble style={{ position: 'absolute', top: 18, right: 30 }}>match report</Scribble>
        <div className="sb-team blue">
          <div className="tname">Blue</div>
          <Lineup players={t0} />
        </div>
        <div>
          <div className="sb-score">
            <span className="s0"><CountUp value={m.team0_score} duration={700} /></span>
            <span className="dash">–</span>
            <span className="s1"><CountUp value={m.team1_score} duration={700} /></span>
          </div>
          {m.meta?.teamXg && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
              xG <span style={{ color: 'var(--blue)' }}>{m.meta.teamXg[0].toFixed(2)}</span>
              {' – '}
              <span style={{ color: 'var(--orange)' }}>{m.meta.teamXg[1].toFixed(2)}</span>
            </div>
          )}
          <div className="sb-meta">
            <span>{m.map}</span><span>{fmtDate(m.date)}</span><span>{fmtDur(dur)} min</span>
            <span className="badge mode">{m.team_size}v{m.team_size}</span>
            {m.overtime && <span className="badge ot">Overtime</span>}
          </div>
        </div>
        <div className="sb-team orange">
          <div className="tname">Orange</div>
          <Lineup players={t1} />
        </div>
      </div>

      {/* GOAL TIMELINE */}
      <div className="goal-timeline">
        <div className="gt-track">
          <div className="gt-mid" style={{ left: '50%' }} />
          {(m.meta?.goals || []).map((g, i) => (
            <div key={i} className={`gt-goal t${g.team}`} style={{ left: `${(g.time / maxT) * 100}%` }}>
              <div className="tip">{g.player} · {fmtDur(g.time)}</div>
            </div>
          ))}
        </div>
        <div className="gt-labels"><span>0:00</span><span>{fmtDur(maxT)}</span></div>
      </div>

      {/* POSSESSION */}
      {m.meta?.teamPossession && (
        <div className="poss-wrap">
          <div className="poss-bar">
            <div className="p0" style={{ width: `${m.meta.teamPossession.pct0}%` }}>{m.meta.teamPossession.pct0}%</div>
            <div className="p1">{m.meta.teamPossession.pct1}%</div>
          </div>
          <div className="footnote" style={{ textAlign: 'center' }}>Possession</div>
        </div>
      )}

      {/* KEY FACTORS — what decided the match */}
      {(() => {
        const facts = matchFactors(m);
        if (!facts.length) return null;
        const winner = m.team0_score > m.team1_score ? 0 : 1;
        return (
          <div className="factor-wrap">
            <div className="factor-head">
              Why {winner === 0 ? 'Blue' : 'Orange'} won
              <span className="sheet-note">the stats that decided this match</span>
            </div>
            <div className="factor-grid">
              {facts.map((f) => (
                <div key={f.title} className={`factor-card t${f.team}`}>
                  <div className="factor-title">
                    {f.title}
                    {f.team !== winner && <span className="factor-vain">not enough</span>}
                  </div>
                  <div className="factor-detail">{f.detail}</div>
                  <div className="factor-meter"><span style={{ width: `${f.impact}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* STICKY SECTION NAV */}
      <nav className="subnav">
        {SECTIONS.map(([sid, label]) => (
          <a key={sid} href={`#${sid}`} className={active === sid ? 'active' : ''}>{label}</a>
        ))}
      </nav>

      {/* ===== OVERVIEW ===== */}
      <SectionHead id="overview" title="Overview" />
      <Reveal>
        <div className="cmp-wrap card" style={{ marginBottom: 14 }}>
          <table className="cmp ranks-table">
            <thead>
              <tr>
                <th>Player</th>
                <th title="Benchmark-model estimate from this match's stats (34 metrics vs rank centroids), anchored to the known ranks in this lobby so one hot or cold game can't swing it to an absurd rank">Perf. estimate</th>
                {['1', '2', '3'].map((mm) => (
                  <th key={mm} className={String(m.team_size) === mm ? 'mode-col' : ''}>
                    {mm}v{mm}{String(m.team_size) === mm ? ' · this match' : ''}
                  </th>
                ))}
                <th style={{ textAlign: 'right' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    {fetchMsg && (
                      <span className="rank-note" style={{ color: fetchMsg.ok ? 'var(--green)' : 'var(--gold)', textTransform: 'none', letterSpacing: 0 }}>
                        {fetchMsg.text}
                      </span>
                    )}
                    <button className="trn-refresh" onClick={fetchRanks} disabled={ranksLoading}>
                      {ranksLoading ? 'Fetching…' : 'Fetch actual ranks'}
                    </button>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...m.players].sort((a, b) => a.team - b.team || b.core.score - a.core.score).map((p) => {
                const all = allRanksOf(p);
                return (
                  <tr key={p.key}>
                    <td>
                      <Link to={`/player/${encodeURIComponent(p.key)}`}
                        style={{ color: p.team === 0 ? 'var(--blue)' : 'var(--orange)', fontWeight: 600 }}>
                        {p.name}
                      </Link>
                      {p.smurf?.suspect && (
                        <span className="smurf-badge" style={{ marginLeft: 8 }}
                          title={'Signals:\n· ' + p.smurf.reasons.join('\n· ')}>smurf?</span>
                      )}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <RankBadge tier={p.tier ?? p.estTier} size="sm" estimate={p.tier == null} />
                        <span className="rc-perf">{p.perfRating > 0.25 ? '▲' : p.perfRating < -0.25 ? '▼' : '•'}</span>
                      </span>
                    </td>
                    {['1', '2', '3'].map((mm) => {
                      const rk = all[mm];
                      return (
                        <td key={mm} className={String(m.team_size) === mm ? 'mode-col' : ''}>
                          {rk?.tier != null ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
                              title={`${rk.division || ''}${rk.matches ? ' · ' + rk.matches + ' matches' : ''}${rk.peak?.mmr ? ' · peak ' + rk.peak.mmr : ''}`}>
                              <RankBadge tier={rk.tier} size="sm" />
                              {rk.mmr && <span className="rc-mmr">{rk.mmr}</span>}
                            </span>
                          ) : <span className="rank-note">—</span>}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="footnote">
            Real ranks from tracker.gg per playlist — cached forever, refreshed monthly · newest matches are fetched first ·
            gold = MMR · "~" = performance estimate · ▲/▼ = above/below expectation in this match
          </div>
        </div>
        {m.players.some((p) => p.style?.tags?.length > 0) && (
          <div className="tags-strip">
            {m.players.filter((p) => p.style?.tags?.length).map((p) => (
              <div key={p.key} className="tag-row">
                <span className={`tag-name t${p.team}`}>{p.name}:</span>
                {p.style.tags.map((t) => <span key={t} className="style-tag">{t}</span>)}
              </div>
            ))}
          </div>
        )}
        <div className="detail-grid">
          <div>
            <CompareTable players={m.players} meKey={m.me} rows={[
              { label: 'Score', get: (p) => p.core.score },
              { label: 'Goals', get: (p) => p.core.goals },
              { label: 'Assists', get: (p) => p.core.assists },
              { label: 'Saves', get: (p) => p.core.saves },
              { label: 'Shots', get: (p) => p.core.shots },
              { label: 'Shooting %', get: (p) => p.core.shootingPct, fmt: (v) => v + '%' },
              { label: 'xG', get: (p) => p.xg ? p.xg.total : null },
              { label: 'Finishing (G−xG)', get: (p) => p.xg ? p.xg.finishing : null },
              { label: 'Demos', get: (p) => p.core.demosInflicted },
              { label: 'Demos taken', get: (p) => p.core.demosTaken, lowerBetter: true },
              { label: 'Touches', get: (p) => p.possession.touches },
              { label: 'Possession', get: (p) => p.possession.possessionPct, fmt: (v) => v + '%' },
              { label: 'Game rating (1-99)', get: (p) => p.gameScore ?? null },
              { label: 'Performance (est. tier)', get: (p) => p.estTier, fmt: (v) => tierName(v) },
            ]} />
          </div>
          <div>
            <KeyStats me={m.players.find((p) => p.key === m.me)} prof={myProf} />
            <RatingRadar players={m.players} meKey={m.me} />
          </div>
        </div>
      </Reveal>

      {/* ===== MOMENTUM ===== */}
      {(() => {
        const mom = momentumSeries(m.meta?.fieldTilt || [], m.meta?.goals || []);
        if (mom.length < 4) return null;
        return (
          <>
            <SectionHead id="momentum" title="Momentum" note="who controlled the game — field position + goal impact" />
            <Reveal>
              <div className="card chart-card">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={mom}>
                    <defs>
                      <linearGradient id="momB" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#55a3f5" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#55a3f5" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="momO" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor="#f09a52" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#f09a52" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    {/* numeric axis: a categorical axis silently drops ReferenceDots whose x isn't an exact sample value */}
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']}
                      tick={{ fill: '#7e88ab', fontSize: 11 }} tickFormatter={(t) => fmtDur(t)} minTickGap={50} />
                    <YAxis domain={[-1, 1]} ticks={[-1, 0, 1]} width={58}
                      tick={{ fill: '#7e88ab', fontSize: 11 }}
                      tickFormatter={(v) => (v > 0 ? 'Blue' : v < 0 ? 'Orange' : '')} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => fmtDur(t)}
                      formatter={(v, n) => n === 'm' ? [(v > 0 ? 'Blue' : 'Orange') + ' in control (' + Math.abs(v).toFixed(2) + ')', 'Momentum'] : null} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                    <Area dataKey="pos" stroke="none" fill="url(#momB)" isAnimationActive animationDuration={900} />
                    <Area dataKey="neg" stroke="none" fill="url(#momO)" isAnimationActive animationDuration={900} />
                    <Area dataKey="m" stroke="#b9c2dd" strokeWidth={1.5} fill="none" isAnimationActive animationDuration={900} />
                    {(m.meta?.goals || []).map((g, i) => (
                      <ReferenceDot key={i} x={g.timeActive ?? g.time} y={g.team === 0 ? 0.9 : -0.9} r={5}
                        fill={g.team === 0 ? '#55a3f5' : '#f09a52'} stroke="#010828" strokeWidth={1.5}
                        label={{ value: '⚽', fontSize: 10, position: g.team === 0 ? 'top' : 'bottom', fill: '#b9c2dd' }} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
                <div className="footnote">Above the line = Blue controls play, below = Orange · dots mark goals</div>
              </div>
            </Reveal>
          </>
        );
      })()}

      {/* ===== SHOTS + REPLAY side by side ===== */}
      <div className="detail-grid">
        <div>
          <SectionHead id="shots" title="Shots & xG" />
          <Reveal>
            <div className="card" style={{ textAlign: 'center' }}>
              <ShotMap players={m.players} width={520} />
              <div className="footnote">Circle size = xG (chance quality) · filled = goal · Blue shoots up, Orange down · hover for details</div>
              <CompareTable players={m.players} meKey={m.me} rows={[
                { label: 'Shots on target (det.)', get: (p) => p.xg ? p.xg.onTarget : null },
                { label: 'xG total', get: (p) => p.xg ? p.xg.total : null },
                { label: 'xG per shot', get: (p) => p.xg ? p.xg.perShot : null },
                { label: 'Goals', get: (p) => p.core.goals },
                { label: 'Finishing (G−xG)', get: (p) => p.xg ? p.xg.finishing : null },
                { label: 'Big chances (xG ≥ 0.4)', get: (p) => p.xg ? p.xg.bigChances ?? null : null },
                { label: 'Big chances scored', get: (p) => p.xg ? p.xg.bigChancesScored ?? null : null },
              ]} />
            </div>
          </Reveal>
        </div>
        <div>
          <SectionHead id="replay" title="Replay" />
          <Reveal>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <div className="mode-filter">
                  <button className={`mf ${view3d ? 'active' : ''}`} onClick={() => setView3d(true)}>3D</button>
                  <button className={`mf ${!view3d ? 'active' : ''}`} onClick={() => setView3d(false)}>2D</button>
                </div>
              </div>
              {view3d
                ? <Replay3D matchId={m.id} goals={m.meta?.goals || []} myTeam={myTeam} myKey={m.me} />
                : <ReplayViewer matchId={m.id} goals={m.meta?.goals || []} myTeam={myTeam} />}
            </div>
          </Reveal>
        </div>
      </div>

      {/* ===== DUELS + BOOST ===== */}
      <div className="detail-grid">
        <div>
          <SectionHead id="duels" title="Duels" />
          <Reveal>
            <CompareTable players={m.players} meKey={m.me} rows={[
              { label: '50/50s won', get: (p) => p.possession.fiftiesWon ?? null },
              { label: '50/50s lost', get: (p) => p.possession.fiftiesLost ?? null, lowerBetter: true },
              { label: '50/50 win %', get: (p) => p.possession.fiftyWinPct, fmt: (v) => v + '%' },
              { label: 'Kickoffs won', get: (p) => p.possession.kickoffsWon ?? null },
              { label: 'Kickoffs lost', get: (p) => p.possession.kickoffsLost ?? null, lowerBetter: true },
              { label: 'Kickoffs neutral', get: (p) => p.possession.kickoffsNeutral ?? null },
              { label: 'Kickoff win %', get: (p) => p.possession.kickoffWinPct, fmt: (v) => v + '%' },
              { label: 'Clears', get: (p) => p.possession.clears ?? null },
              { label: 'Clears under pressure', get: (p) => p.possession.pressureClears ?? null },
              { label: 'Takeaways', get: (p) => p.possession.steals },
              { label: 'Turnovers', get: (p) => p.possession.turnovers, lowerBetter: true },
              { label: 'Demos', get: (p) => p.core.demosInflicted },
              { label: 'Conceded as last man', get: (p) => p.possession.concededAsLastMan ?? null, lowerBetter: true },
              { label: 'Caught upfield (goal)', get: (p) => p.positioning.concededWhileAhead ?? null, lowerBetter: true },
              ...(m.team_size > 1 ? [
                { label: 'Left teammate in 2v1', get: (p) => p.positioning.abandoned2v1 ?? null, lowerBetter: true },
                { label: 'Team touch share', get: (p) => p.possession.touchSharePct, fmt: (v) => v + '%' },
              ] : []),
              { label: 'Avg time ahead of ball (s)', get: (p) => p.positioning.aheadStreakAvg ?? null, lowerBetter: true },
            ]} />
          </Reveal>
        </div>
        <div>
          <SectionHead id="boost" title="Boost" />
          <Reveal>
            <CompareTable players={m.players} meKey={m.me} rows={[
              { label: 'Average boost', get: (p) => p.boost.avgAmount },
              { label: 'Boost used', get: (p) => p.boost.used },
              { label: 'Boost collected', get: (p) => p.boost.collected },
              { label: 'Used / min', get: (p) => p.boost.usedPerMin },
              { label: 'Big pads taken', get: (p) => p.boost.bigPads },
              { label: 'Small pads taken', get: (p) => p.boost.smallPads },
              { label: 'Big pads stolen', get: (p) => p.boost.bigPadsStolen },
              { label: 'Boost stolen', get: (p) => p.boost.stolenAmount },
              { label: 'Overfill (wasted)', get: (p) => p.boost.overfill, lowerBetter: true },
              { label: 'Time at 0 boost', get: (p) => p.boost.pctZero, fmt: (v) => v + '%', lowerBetter: true },
              { label: 'Time at 100 boost', get: (p) => p.boost.pctFull, fmt: (v) => v + '%' },
              { label: 'Time at 0–25 boost', get: (p) => p.boost.pct0to25, fmt: (v) => v + '%', lowerBetter: true },
              { label: 'Time at 25–50', get: (p) => p.boost.pct25to50, fmt: (v) => v + '%' },
              { label: 'Time at 50–75', get: (p) => p.boost.pct50to75, fmt: (v) => v + '%' },
              { label: 'Time at 75–100', get: (p) => p.boost.pct75to100, fmt: (v) => v + '%' },
            ]} />
          </Reveal>
        </div>
      </div>

      {/* ===== MOVEMENT + POSITIONING ===== */}
      <div className="detail-grid">
        <div>
          <SectionHead id="movement" title="Movement" />
          <Reveal>
            <CompareTable players={m.players} meKey={m.me} rows={[
              { label: 'Distance (m)', get: (p) => p.movement.distanceM },
              { label: 'Avg speed (uu/s)', get: (p) => p.movement.avgSpeed },
              { label: 'Max speed', get: (p) => p.movement.maxSpeed },
              { label: 'Powerslides', get: (p) => p.movement.powerslides ?? null },
              { label: 'Powerslide time (s)', get: (p) => p.movement.powerslideTimeS ?? null },
              { label: 'Supersonic', get: (p) => p.movement.pctSupersonic, fmt: (v) => v + '%' },
              { label: 'Boost speed', get: (p) => p.movement.pctBoostSpeed, fmt: (v) => v + '%' },
              { label: 'Slow', get: (p) => p.movement.pctSlow, fmt: (v) => v + '%', lowerBetter: true },
              { label: 'On ground', get: (p) => p.movement.pctGround, fmt: (v) => v + '%', lowerBetter: true },
              { label: 'Low air', get: (p) => p.movement.pctLowAir, fmt: (v) => v + '%' },
              { label: 'High air', get: (p) => p.movement.pctHighAir, fmt: (v) => v + '%' },
            ]} />
          </Reveal>
        </div>
        <div>
          <SectionHead id="positioning" title="Positioning" />
          <Reveal>
            <CompareTable players={m.players} meKey={m.me} rows={[
              { label: 'Defensive half', get: (p) => p.positioning.pctDefHalf, fmt: (v) => v + '%' },
              { label: 'Attacking half', get: (p) => p.positioning.pctOffHalf, fmt: (v) => v + '%' },
              { label: 'Defensive third', get: (p) => p.positioning.pctDefThird, fmt: (v) => v + '%' },
              { label: 'Middle third', get: (p) => p.positioning.pctNeutThird, fmt: (v) => v + '%' },
              { label: 'Attacking third', get: (p) => p.positioning.pctOffThird, fmt: (v) => v + '%' },
              { label: 'Behind ball', get: (p) => p.positioning.pctBehindBall, fmt: (v) => v + '%' },
              { label: 'Ahead of ball', get: (p) => p.positioning.pctAheadOfBall, fmt: (v) => v + '%', lowerBetter: true },
              { label: 'Distance to ball (m)', get: (p) => p.positioning.avgDistToBallM, lowerBetter: true },
              ...(m.team_size > 1 ? [
                { label: 'Last man', get: (p) => p.positioning.pctMostBack, fmt: (v) => v + '%' },
                { label: 'First man', get: (p) => p.positioning.pctMostForward, fmt: (v) => v + '%' },
                { label: 'Closest to ball', get: (p) => p.positioning.pctClosestToBall, fmt: (v) => v + '%' },
                { label: 'Teammate distance (m)', get: (p) => p.positioning.avgTeammateDistM },
                { label: 'Double commits', get: (p) => p.positioning.doubleCommits ?? null, lowerBetter: true },
              ] : []),
            ]} />
          </Reveal>
        </div>
      </div>

      {/* ===== POSSESSION ===== */}
      <div className={tilt.length > 3 ? 'detail-grid' : undefined}>
        <div>
          <SectionHead id="possession" title="Possession" />
          <Reveal>
            <CompareTable players={m.players} meKey={m.me} rows={[
              { label: 'Touches', get: (p) => p.possession.touches },
              { label: 'Touches / min', get: (p) => p.possession.touchesPerMin },
              { label: 'Aerial touches', get: (p) => p.possession.aerialTouches },
              { label: 'Possession (s)', get: (p) => p.possession.possessionTime },
              { label: 'Possession %', get: (p) => p.possession.possessionPct, fmt: (v) => v + '%' },
              { label: 'Dribbles', get: (p) => p.possession.dribbles },
              ...(m.team_size > 1 ? [
                { label: 'Passes', get: (p) => p.possession.passes },
                { label: 'Passes received', get: (p) => p.possession.passesReceived },
              ] : []),
              { label: 'Turnovers', get: (p) => p.possession.turnovers, lowerBetter: true },
              { label: 'Takeaways', get: (p) => p.possession.steals },
              { label: 'Kickoff first touches', get: (p) => p.possession.firstTouches },
              { label: 'Kickoff first touch %', get: (p) => p.possession.kickoffFirstTouchPct, fmt: (v) => v + '%' },
            ]} />
          </Reveal>
        </div>
        {tilt.length > 3 && (
          <div>
            <SectionHead title="Field tilt" note="where the ball was played" />
            <Reveal>
              <div className="card chart-card">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={tilt}>
                    <defs>
                      <linearGradient id="tiltG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f09a52" stopOpacity={0.45} />
                        <stop offset="50%" stopColor="#666" stopOpacity={0.05} />
                        <stop offset="100%" stopColor="#55a3f5" stopOpacity={0.45} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="t" tick={{ fill: '#7e88ab', fontSize: 11 }} tickFormatter={(t) => fmtDur(t)} />
                    <YAxis domain={[-1, 1]} ticks={[-1, 0, 1]} tick={{ fill: '#7e88ab', fontSize: 11 }}
                      tickFormatter={(v) => (v > 0 ? 'Orange goal' : v < 0 ? 'Blue goal' : 'midfield')} width={70} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => fmtDur(t)}
                      formatter={(v) => [v > 0 ? 'near Orange goal' : 'near Blue goal', 'Ball']} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />
                    <Area dataKey="y" stroke="#7e88ab" strokeWidth={1.5} fill="url(#tiltG)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Reveal>
          </div>
        )}
      </div>

      {/* ===== HEATMAPS ===== */}
      <SectionHead id="heatmaps" title="Heatmaps" />
      <Reveal>
        <div className="card">
          <div className="pill-select">
            {m.players.map((p) => (
              <button key={p.key}
                className={`pill ${(heatSel ?? heatPlayer?.key) === p.key ? `active t${p.team}` : ''}`}
                onClick={() => setHeatSel(p.key)}>
                {p.name}
              </button>
            ))}
            <button className={`pill ${heatSel === 'ball' ? 'active ball' : ''}`} onClick={() => setHeatSel('ball')}>Ball</button>
          </div>
          <div className="heat-row">
            {heatSel === 'ball' ? (
              <div className="heat-item">
                <FieldHeatmap grid={m.meta?.ballHeatmap} width={380} />
                <div className="hname">Ball position</div>
              </div>
            ) : heatPlayer && (
              <>
                <div className="heat-item">
                  <FieldHeatmap grid={heatPlayer.heatmap} flip={heatPlayer.team === 1} width={380} />
                  <div className="hname">Positions — {heatPlayer.name}</div>
                </div>
                <div className="heat-item">
                  <FieldHeatmap grid={null} flip={heatPlayer.team === 1} touchPoints={heatPlayer.touchPoints}
                    width={380} accent={heatPlayer.team === 0 ? '#55a3f5' : '#f09a52'} />
                  <div className="hname">Ball touches — {heatPlayer.name}</div>
                </div>
              </>
            )}
          </div>
          <div className="footnote" style={{ textAlign: 'center' }}>Own goal at bottom · opponent at top</div>
        </div>
      </Reveal>
    </>
  );
}
