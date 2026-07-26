import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell, AreaChart, Area, Legend, ReferenceLine,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import { api, fmtDate, fmtDur } from '../api.js';
import FieldHeatmap from '../components/FieldHeatmap.jsx';
import RotationMap from '../components/RotationMap.jsx';
import CountUp from '../components/CountUp.jsx';
import RankBadge from '../components/RankBadge.jsx';
import { tierName, ALL_TIERS } from '../tiers.js';
import { downloadPagePng } from '../shareCard.js';
import { strengthsWeaknesses, STAT_DEFS } from '../statDefs.js';
import Scribble from '../components/Scribble.jsx';

const tooltipStyle = {
  background: '#071033', border: '1px solid rgba(255,255,255,0.13)',
  borderRadius: 10, fontSize: 13, color: '#EFF4FF',
};

/** Radar label: component name + numeric value (Anton), offset from the vertex. */
function RadarTick({ payload, x, y, cx, cy, textAnchor, avg }) {
  const v = avg?.[payload.value.toLowerCase()];
  // push the label a bit further from the center so it doesn't sit on the polygon
  const dx = (x - cx) * 0.12, dy = (y - cy) * 0.12;
  return (
    <g>
      <text x={x + dx} y={y + dy} textAnchor={textAnchor} fill="#7e88ab"
        style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
        {payload.value}
      </text>
      {v != null && (
        <text x={x + dx} y={y + dy + 16} textAnchor={textAnchor} fill="#EFF4FF"
          style={{ fontFamily: 'Anton, sans-serif', fontSize: 15, letterSpacing: 0.5 }}>
          {Math.round(v)}
        </text>
      )}
    </g>
  );
}

const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');

// archetype and modifier explanations (from the playstyle axes)
const ARCH_DESC = {
  Striker: () => 'You finish plays. High shot volume and conversion — the ball ends up in the net when it reaches you. Just don\'t forget someone has to rotate back.',
  Playmaker: () => 'You create more than you finish — high possession, constant touches and assists that set your teammate up. The offense runs through you.',
  Ballchaser: () => 'You live on the ball side of the field — first to every ball, relentless pressure, not much patience for sitting back. Opponents feel hunted; your teammate sometimes too.',
  Lawnmower: () => 'You own the floor — supersonic on the ground, cutting across the field, rarely leaving the deck. What you lack in air presence you make up in constant ground threat.',
  'Aerial ace': () => 'The air is your territory — aerial touches, high-air time and mechanics most players don\'t attempt. You attack angles others can\'t reach.',
  'The Wall': () => 'Nothing gets past you cheaply — saves, clears and a permanent goalside presence. Teams win games off the chances you deny.',
  'Demo merchant': () => 'You play the man as much as the ball — demos and bumps break the opponent\'s structure and tilt lobbies. Chaos is a strategy.',
  'Boost scavenger': () => 'You starve opponents — stealing their big pads, picking their pockets and winning the resource war before the ball war.',
  'Kickoff bully': () => 'You win games in the first three seconds — kickoff after kickoff goes your way, and every restart is a chance to take the lead.',
  'All-rounder': (ax) => `No single dimension dominates (attack ${ax.attack} / defense ${ax.defense}) — you rotate through whatever the play needs and adapt to your lobby.`,
  // legacy names (old cache/profiles)
  Attacker: (ax) => `Your attack axis (${ax.attack}) clearly outweighs defense (${ax.defense}) — you push high, create the chances and take the shots.`,
  Defender: (ax) => `Your defense axis (${ax.defense}) outweighs attack (${ax.attack}) — you anchor the last line, make the saves and clear danger.`,
  'Balanced player': (ax) => `Attack (${ax.attack}) and defense (${ax.defense}) are close — you rotate through whatever the play needs.`,
};
const MOD_DESC = {
  aerial: 'strong air presence — plenty of aerial touches and high-air time',
  fast: 'high tempo — above-average supersonic time',
  technical: 'good ball control — dribbles and passes with few turnovers',
  'turnover-prone': 'loses the ball often — the control axis is low',
  'strong in duels': 'wins 50/50s and kickoffs more often than most',
};
const AXIS_LABELS = { attack: 'Attack', defense: 'Defense', control: 'Control', speed: 'Speed', aerial: 'Aerial', duels: 'Duels' };

// advice for weak percentiles (filler when the server doesn't find enough "leaks")
const WEAK_ADVICE = {
  goals: 'Shoot from higher-value spots — get closer before pulling the trigger instead of hopeful half-field shots.',
  shots: 'You barely test the keeper — challenge more balls in the attacking third and follow up rebounds.',
  shootingPct: 'Pick a corner before you shoot; placement beats power at this rank.',
  xg: 'You rarely reach dangerous positions — push up on offense and attack crosses in front of goal.',
  finishing: 'You score less than your chances are worth — grind shooting packs for consistency.',
  saves: 'Track back earlier so you arrive set for the save, not sliding past it.',
  clears: 'When in doubt, clear wide off the wall — never up the middle.',
  pressureClears: 'Under pressure, take the safe touch to the corner instead of trying to beat the challenge.',
  pctBehindBall: 'Rotate back through your own half after every touch — target 65%+ time behind ball.',
  concededAsLastMan: 'As last man, shadow the ball instead of challenging — make the attacker beat you twice.',
  concededWhileAhead: 'Recover goal-side the moment possession is lost — goals are conceded while you are upfield.',
  demosTaken: 'You get demoed a lot — check for incoming cars and jump/dodge when rotating through midfield.',
  abandoned2v1: 'After a failed attack, recover immediately — your teammate keeps defending 1v2.',
  doubleCommits: 'Look at your teammate before committing; if they are closer, peel off and cover.',
  aheadStreakAvg: 'You stay ahead of the ball too long — cut rotations short and get goal-side sooner.',
  pctLostForward: 'You are often stranded upfield when the play breaks — rotate out earlier.',
  turnovers: 'Stop touching the ball without a plan — every aimless touch is a free counter for them.',
  steals: 'Press the carrier more — read their touches and step in front of the next one.',
  possessionPct: 'Keep the ball on your side of the play: catch bounces, use walls, slow the game down.',
  touchesPerMin: 'You are too far from the play — tighter rotations get you more touches.',
  fiftyWinPct: 'Go in second in 50/50s and aim through the center of the ball.',
  kickoffWinPct: 'Learn a consistent speed-flip kickoff — free goals leak here.',
  aerialTouches: 'Practice basic aerials — balls above bar height are currently free for the opponent.',
  demos: 'Add demo threat on offense — a bump at the right time breaks their whole rotation.',
  avgBoost: 'You run on empty — pick up small pads along your rotation path to stay above 30.',
  boostPerMin: 'You use very little boost — spend it to be first to the ball, it regenerates.',
  pctZeroBoost: 'Too much time at 0 boost — route through small pads instead of detouring to corners.',
  bigPadsStolen: 'Steal opponent big pads on offense — it starves their counters.',
  avgSpeed: 'Keep momentum — carry speed through turns instead of stopping and starting.',
  pctSupersonic: 'Increase tempo — more supersonic time wins you first touches.',
  pctHighAir: 'Work on high-air control — you never contest balls near the ceiling.',
};

// leak titles → stat keys they already cover (to avoid duplicates)
const LEAK_COVERS = {
  '50/50 challenges': ['fiftyWinPct'], Turnovers: ['turnovers'], 'Boost economy': ['pctZeroBoost', 'avgBoost'],
  Kickoffs: ['kickoffWinPct'], 'Last line of defense': ['concededAsLastMan'], 'Double commits': ['doubleCommits'],
  'Leaving teammate in a 2v1': ['abandoned2v1'], 'Caught upfield on conceded goals': ['concededWhileAhead'],
  Finishing: ['finishing'], Rotation: ['pctBehindBall'],
};

export default function Dashboard({ mode = '', playerKey = null }) {
  const [p, setP] = useState(undefined);
  const [matches, setMatches] = useState([]);
  const [trn, setTrn] = useState(null);
  const [modeProfiles, setModeProfiles] = useState({});
  const [mmrHistory, setMmrHistory] = useState([]);
  const [benchmark, setBenchmark] = useState(null);
  const [fellBack, setFellBack] = useState(false); // player profile has no matches in the selected mode → show all modes
  const [exporting, setExporting] = useState(false);
  const [isFav, setIsFav] = useState(false);

  useEffect(() => {
    if (!playerKey) return;
    api.favorites().then((d) => setIsFav(d.favorites.some((f) => f.key === playerKey))).catch(() => {});
  }, [playerKey]);
  const isMe = !playerKey;

  useEffect(() => {
    setP(undefined); setFellBack(false);
    (async () => {
      let prof = await api.profile(playerKey, mode || null).catch(() => null);
      let fb = false;
      if (!prof && playerKey && mode) {
        prof = await api.profile(playerKey, null).catch(() => null);
        fb = !!prof;
      }
      setFellBack(fb);
      setP(prof);
      const effMode = fb ? null : (mode || null);
      api.matches(playerKey, effMode).then((r) => setMatches(r.matches.filter((m) => m.me).slice(0, 8))).catch(() => {});
    })();
    if (isMe) {
      api.rank().then(setTrn).catch(() => {});
      api.rankHistory(mode || null).then((r) => setMmrHistory(r.history || [])).catch(() => {});
      if (mode) api.benchmark(mode).then(setBenchmark).catch(() => setBenchmark(null));
      else setBenchmark(null);
    } else { setTrn(null); setMmrHistory([]); setBenchmark(null); }
    if (!mode && isMe) {
      for (const m of ['1', '2', '3']) {
        api.profile(null, m).then((mp) => setModeProfiles((prev) => ({ ...prev, [m]: mp }))).catch(() => {});
      }
    }
  }, [mode, playerKey, isMe]);

  const refreshRank = async () => {
    setTrn({ loading: true });
    const r = await api.rank(true).catch(() => ({ error: 'error' }));
    setTrn(r);
    api.profile(null, mode || null).then(setP);
  };

  const setManualTier = async (v) => {
    await api.saveSettings({ mode, manualTier: v === '' ? null : Number(v) });
    api.profile(null, mode || null).then(setP);
  };

  if (p === undefined) return <div className="empty"><h3>Loading…</h3></div>;
  if (!p) return (
    <div className="empty">
      <h3>No data</h3>
      {isMe
        ? <p>{mode ? 'No matches for this mode filter — try "All", or click' : 'Click'} "Sync" in the top right to import your saved replays.</p>
        : <p>No matches found for this player.</p>}
    </div>
  );

  const trend = p.trend.map((t, i) => ({ ...t, i: i + 1 }));
  const trnTier = p.rank.trn?.tier ?? null;
  const shownTier = p.rank.replayTier ?? trnTier ?? p.rank.manualTier;
  const rankDelta = shownTier != null && p.rank.estTierRecent != null ? p.rank.estTierRecent - shownTier : null;
  const modeLabel = fellBack ? 'all modes' : mode === '1' ? '1v1' : mode === '2' ? '2v2' : mode === '3' ? '3v3' : 'all modes';
  const teamMode = mode !== '1';
  const av = p.averages;
  const pc = p.percentiles || {};

  // streaks from the chronological trend
  const streaks = (() => {
    let cur = 0, bestW = 0, run = 0;
    for (const t of p.trend) {
      if (t.win > 0) { run++; if (run > bestW) bestW = run; } else run = 0;
    }
    for (let i = p.trend.length - 1; i >= 0; i--) {
      const w = p.trend[i].win > 0;
      if (cur === 0) cur = w ? 1 : -1;
      else if ((cur > 0) === w) cur += w ? 1 : -1;
      else break;
    }
    return { cur, bestW };
  })();

  // row in the stat sheet: [label, value, decimals, suffix, percentileKey]
  const R = (label, value, dec = 1, suffix = '', pctKey = null) => ({ label, value, dec, suffix, pctKey });

  const SHEET = [
    {
      title: 'Attack', rows: [
        R('Goals / game', p.perGame.goals, 1, '', 'goals'),
        R('Assists / game', p.perGame.assists, 1, '', 'assists'),
        R('Shots / game', p.perGame.shots, 1, '', 'shots'),
        R('Shooting %', p.perGame.shootingPct, 1, '%', 'shootingPct'),
        R('xG / game', p.xg.xgPerGame, 2, '', 'xg'),
        R('Finishing (G−xG)', p.xg.finishingPerGame, 2, '', 'finishing'),
        R('Big chances', `${p.xg.bigChancesScored}/${p.xg.bigChances}`, null),
        R('Sitters (xG ≥ 0.6)', `${av.zicersScored}/${av.zicers}`, null),
        R('Score / game', p.perGame.score, 0, '', 'score'),
      ],
    },
    {
      title: 'Defense', rows: [
        R('Saves / game', p.perGame.saves, 1, '', 'saves'),
        R('Clears / game', av.clears, 1, '', 'clears'),
        R('Clears under pressure', av.pressureClears, 1, '', 'pressureClears'),
        R('Time behind ball', av.pctBehindBall, 1, '%', 'pctBehindBall'),
        R('Conceded as last man', av.concededAsLastMan, 1, '', 'concededAsLastMan'),
        R('Caught upfield', av.concededWhileAhead, 1, '', 'concededWhileAhead'),
        R('Demos taken', p.totals.demosTaken / Math.max(1, p.games), 1, '', 'demosTaken'),
      ],
    },
    {
      title: 'Rotation & discipline', rows: [
        ...(teamMode ? [
          R('Left teammate in 2v1', av.abandoned2v1, 1, '', 'abandoned2v1'),
          R('Double commits', av.doubleCommits, 1, '', 'doubleCommits'),
          ...(av.touchSharePct != null ? [R('Team touch share', av.touchSharePct, 0, '%')] : []),
        ] : []),
        R('Time ahead of ball', av.aheadStreakAvg, 1, ' s', 'aheadStreakAvg'),
        R('Stranded upfield', av.pctLostForward, 1, '%', 'pctLostForward'),
        R('Turnovers', av.turnovers, 1, '', 'turnovers'),
        R('Takeaways', av.steals, 1, '', 'steals'),
      ],
    },
    {
      title: 'Possession & duels', rows: [
        R('Possession', av.possessionPct, 1, '%', 'possessionPct'),
        R('Touches / min', av.touchesPerMin, 1, '', 'touchesPerMin'),
        R('50/50s won', av.fiftyWinPct ?? 0, 0, '%', 'fiftyWinPct'),
        R('Kickoff wins', av.kickoffWinPct ?? 0, 0, '%', 'kickoffWinPct'),
        R('Kickoff first touch', av.kickoffFirstTouchPct, 0, '%'),
        R('Aerial touches / game', av.aerialTouches, 1, '', 'aerialTouches'),
        R('Demos / game', p.perGame.demos, 1, '', 'demos'),
      ],
    },
    {
      title: 'Boost', rows: [
        R('Average boost', av.avgBoost, 1, '', 'avgBoost'),
        R('Usage / min', av.boostPerMin, 0, '', 'boostPerMin'),
        R('Time at 0', av.pctZeroBoost, 1, '%', 'pctZeroBoost'),
        R('Time at 100', av.pctFullBoost, 1, '%'),
        R('Big pads / game', av.bigPads, 1),
        R('Big pads stolen / game', av.stolenBigPads, 1, '', 'bigPadsStolen'),
      ],
    },
    {
      title: 'Movement', rows: [
        R('Avg speed (uu/s)', av.avgSpeed, 0, '', 'avgSpeed'),
        R('Powerslides / game', av.powerslides ?? 0, 1, '', 'powerslides'),
        R('Powerslide time', av.powerslideTimeS ?? 0, 1, ' s'),
        R('Supersonic', av.pctSupersonic, 1, '%', 'pctSupersonic'),
        R('On ground', av.pctGround, 1, '%'),
        R('Low air', av.pctLowAir, 1, '%'),
        R('High air', av.pctHighAir, 1, '%', 'pctHighAir'),
        R('Distance to ball', av.avgDistToBallM, 0, ' m'),
        ...(teamMode && p.games ? [] : []),
      ],
    },
  ];

  return (
    <>
      {!isMe && (
        <p style={{ marginBottom: 14 }}>
          <Link to="/opponents" style={{ color: 'var(--accent)', fontSize: 14 }}>← Back</Link>
          <span style={{ color: '#7e88ab', fontSize: 13, marginLeft: 14 }}>Player profile from your matches</span>
          {fellBack && (
            <span style={{ color: 'var(--gold)', fontSize: 13, marginLeft: 14 }}>
              No {mode}v{mode} matches with this player — showing all modes
            </span>
          )}
        </p>
      )}

      {/* ===== COMPACT HEADER ===== */}
      <div className="share-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="trn-refresh" disabled={exporting} onClick={async () => {
          setExporting(true);
          try {
            await downloadPagePng(`rl-profile-${p.name.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.png`);
          } finally { setExporting(false); }
        }}>
          {exporting ? 'Rendering…' : '⤓ Full page PNG'}
        </button>
      </div>
      <div className="phero card">
        <div className="phero-wm" aria-hidden="true">{p.style?.archetype || 'player'}</div>
        <div className="phero-main">
          <div style={{ maxWidth: 640 }}>
            <div className="phero-kicker">Player profile · {modeLabel}</div>
            <h1 className="phero-name">
              {p.name}
              {playerKey && (
                <button className={`fav-btn ${isFav ? 'on' : ''}`}
                  title={isFav ? 'Remove from favorite players' : 'Add to favorite players (Players page)'}
                  onClick={async () => {
                    const d = await api.toggleFavorite(playerKey, p.name).catch(() => null);
                    if (d) setIsFav(d.favorited);
                  }}>
                  {isFav ? '★' : '☆'}
                </button>
              )}
            </h1>
            {p.accounts?.length > 1 && (
              <div className="rank-note" style={{ marginTop: 6 }}>{p.accounts.length} accounts: {p.accounts.map((a) => a.name).join(' · ')}</div>
            )}
            {p.style && (
              <div className="phero-arch">
                <Scribble>plays like</Scribble>
                <div className="pa-name">{p.style.archetype}</div>
                {p.style.archetype2 && <div className="pa-second">with a hint of {p.style.archetype2}</div>}
                {p.style.modifiers.length > 0 && (
                  <div className="phero-mods">
                    {p.style.modifiers.map((m) => <span key={m} className="badge mode" title={MOD_DESC[m] || ''}>{m}</span>)}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="id-cards">
            {p.rank.sessionTier != null && (() => {
              const today = new Date().toISOString().slice(0, 10) === p.rank.sessionDay;
              const when = today ? 'Today'
                : new Date(p.rank.sessionDay + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              const t = Math.max(0, Math.min(22, Math.round(p.rank.sessionTier)));
              return (
                <div className="session-est"
                  title={`Session form — the model reads your ${today ? 'play today' : `last session (${when})`} as ${tierName(t)} over ${p.rank.sessionGames} game${p.rank.sessionGames > 1 ? 's' : ''}${p.rank.gbdt ? ' (GBDT model)' : ''}`}>
                  <div className="se-label">Session form</div>
                  <div className="se-icon-wrap">
                    <img className="se-icon" src={`/ranks/${t}.png`} alt={tierName(t)} />
                  </div>
                  <div className="se-when">{when}</div>
                  <div className="se-games">{p.rank.sessionGames} game{p.rank.sessionGames > 1 ? 's' : ''}</div>
                </div>
              );
            })()}
            {shownTier != null && (
              <div className="session-est"
                title={`Your actual competitive rank (${modeLabel}) — from tracker.gg${p.rank.trn?.mmr ? `, ${p.rank.trn.mmr} MMR` : ''}`}>
                <div className="se-label">Current rank</div>
                <div className="se-icon-wrap">
                  <img className="se-icon" src={`/ranks/${Math.max(0, Math.min(22, Math.round(shownTier)))}.png`} alt={tierName(shownTier)} />
                </div>
                <div className="se-when">{tierName(shownTier)}</div>
                <div className="se-games">tracker.gg</div>
              </div>
            )}
            {p.rank.estTierRecent != null && (
              <div className="session-est"
                title={`How the model reads your recent performance (last 8 games) — ${tierName(p.rank.estTierRecent)}${p.rank.estSource === 'gbdt' ? ', GBDT model calibrated to tracker.gg ranks' : ''}`}>
                <div className="se-label">Model estimate</div>
                <div className="se-icon-wrap">
                  <img className="se-icon" src={`/ranks/${Math.max(0, Math.min(22, Math.round(p.rank.estTierRecent)))}.png`} alt={tierName(p.rank.estTierRecent)} />
                </div>
                <div className="se-when">{tierName(p.rank.estTierRecent)}&thinsp;~</div>
                <div className="se-games">{p.rank.estSource === 'gbdt' ? 'GBDT · last 8 games' : 'last 8 games'}</div>
              </div>
            )}
          </div>
        </div>
        <div className="phero-stats">
          <div className="ph"><div className="phv">{p.wins}–{p.losses}</div><div className="phl">Record</div></div>
          <div className="ph"><div className="phv"><CountUp value={p.winPct} />%</div><div className="phl">Win rate</div></div>
          <div className="ph"><div className="phv">{p.coaching?.avgGameScore != null ? <CountUp value={p.coaching.avgGameScore} /> : '—'}</div><div className="phl">Form</div></div>
          <div className="ph"><div className="phv"><CountUp value={p.games} /></div><div className="phl">Games</div></div>
          <div className="ph"><div className="phv"><CountUp value={p.mvps} /></div><div className="phl">MVPs</div></div>
          <div className="ph">
            <div className="phv" style={{ color: streaks.cur > 0 ? '#6FFF00' : '#ff6d6d' }}>
              {streaks.cur > 0 ? `W${streaks.cur}` : `L${Math.abs(streaks.cur)}`}
            </div>
            <div className="phl">Streak (best W{streaks.bestW})</div>
          </div>
          <div className="ph"><div className="phv"><CountUp value={p.perGame.goals} decimals={1} /></div><div className="phl">Goals/gm</div></div>
          <div className="ph"><div className="phv"><CountUp value={p.perGame.saves} decimals={1} /></div><div className="phl">Saves/gm</div></div>
          <div className="ph"><div className="phv"><CountUp value={p.totals.timePlayedMin} /></div><div className="phl">Minutes</div></div>
        </div>
      </div>

      {/* ===== RATING PROFILE + ARCHETYPE (at the top) ===== */}
      {(p.ratingAvg || p.style) && (
        <div className="top-grid">
          {p.ratingAvg && (
            <div className="card coach-panel">
              <div className="sheet-h">Rating profile — career components</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1fr) 1.1fr', gap: 18, alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <ResponsiveContainer width="100%" height={235}>
                    <RadarChart data={[
                      { k: 'Attack', v: p.ratingAvg.attack }, { k: 'Defense', v: p.ratingAvg.defense },
                      { k: 'Possession', v: p.ratingAvg.possession }, { k: 'Boost', v: p.ratingAvg.boost },
                      { k: 'Pressure', v: p.ratingAvg.pressure },
                    ].map((d) => ({ ...d, avg: 50 }))} outerRadius="72%">
                      <defs>
                        <radialGradient id="radarFill">
                          <stop offset="35%" stopColor="#6FFF00" stopOpacity={0.02} />
                          <stop offset="100%" stopColor="#6FFF00" stopOpacity={0.34} />
                        </radialGradient>
                        <filter id="radarGlow" x="-40%" y="-40%" width="180%" height="180%">
                          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#6FFF00" floodOpacity="0.45" />
                        </filter>
                      </defs>
                      <PolarGrid stroke="rgba(239,244,255,0.07)" />
                      <PolarAngleAxis dataKey="k" tick={<RadarTick avg={p.ratingAvg} />} />
                      <PolarRadiusAxis domain={[0, 99]} tick={false} axisLine={false} />
                      {/* reference polygon: 50 = average player from your matches */}
                      <Radar dataKey="avg" stroke="rgba(239,244,255,0.28)" strokeDasharray="4 5" fill="none" strokeWidth={1} isAnimationActive={false} />
                      <Radar dataKey="v" stroke="#6FFF00" fill="url(#radarFill)" fillOpacity={1} strokeWidth={2.5}
                        filter="url(#radarGlow)" dot={{ r: 3.5, fill: '#6FFF00', stroke: '#010828', strokeWidth: 1.5 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                  <div className="footnote" style={{ marginTop: -6 }}>dashed ring = 50 (avg player from your lobbies)</div>
                </div>
                <div>
                  {[['Overall', 'overall'], ['Attack', 'attack'], ['Defense', 'defense'], ['Possession', 'possession'], ['Boost', 'boost'], ['Pressure', 'pressure']].map(([label, k]) => {
                    const pctV = p.ratingAvg.pct?.[k];
                    return (
                      <div key={k} className="srow" style={{ gridTemplateColumns: '86px 34px 1fr 62px' }}
                        title={pctV != null ? `Better than ${pctV}% of players from your matches` : undefined}>
                        <span className="slbl" style={k === 'overall' ? { color: 'var(--text)', fontWeight: 650 } : undefined}>{label}</span>
                        <span className="sval">{p.ratingAvg[k].toFixed(0)}</span>
                        <span className="spct" style={{ justifySelf: 'stretch' }}>
                          {pctV != null && (
                            <span className="pbar" style={{ width: '100%' }}>
                              <span className={`pfill ${pctV >= 65 ? 'hi' : pctV >= 35 ? 'mid' : 'lo'}`} style={{ width: pctV + '%' }} />
                            </span>
                          )}
                        </span>
                        <span className="ks-avg" style={{ textAlign: 'right' }}>{pctV != null ? `${ord(pctV)} pct` : ''}</span>
                      </div>
                    );
                  })}
                  <div className="footnote">Percentile vs all players from your matches ({modeLabel})</div>
                </div>
              </div>
            </div>
          )}
          {p.style && (
            <div className="card coach-panel">
              <div className="sheet-h">Playstyle — {p.style.archetype}</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)', marginBottom: 12 }}>
                {(ARCH_DESC[p.style.archetype] || ARCH_DESC['Balanced player'])(p.style.axes)}
              </p>
              <div className="style-axes" style={{ marginBottom: 12 }}>
                {Object.entries(AXIS_LABELS).map(([k, label]) => (
                  <div key={k} className="axis-row">
                    <span className="axis-name">{label}</span>
                    <span className="axis-track"><span className="axis-fill" style={{ width: `${p.style.axes[k] ?? 0}%` }} /></span>
                    <span className="axis-val">{p.style.axes[k] ?? 0}</span>
                  </div>
                ))}
              </div>
              {p.style.modifiers.length > 0 && (
                <div>
                  {p.style.modifiers.map((mo) => (
                    <div key={mo} className="plan-item" style={{ padding: '3px 0' }}>
                      <span style={{ color: 'var(--accent)' }}>•</span>
                      <span><b>{mo}</b>{MOD_DESC[mo] ? <span className="plan-tip"> — {MOD_DESC[mo]}</span> : null}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== GAP TO NEXT RANK (statistical, from the benchmark) ===== */}
      {p.nextRankGap && (() => {
        const g = p.nextRankGap;
        const fmtV = (v, def) => {
          const d = def?.dec ?? 1;
          return `${Math.round(v * 10 ** d) / 10 ** d}${def?.suffix || ''}`;
        };
        return (
          <div className="card coach-panel" style={{ marginBottom: 22 }}>
            <div className="sheet-h" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              Gap to next rank
              <RankBadge tier={g.nextTier} size="sm" />
              <span className="sheet-note" style={{ margin: 0 }}>
                your last {g.basedOnGames} games vs {tierName(g.nextTier)} benchmark averages (interpolated, {g.benchN.toLocaleString('en-GB')} player-games) · sorted by how far behind you are (z)
              </span>
            </div>
            <div className="gap-head">
              <span>Stat</span><span>You</span><span className="gap-cur">{tierName(g.curTier ?? g.nextTier - 1)} avg</span>
              <span className="gap-next">{tierName(g.nextTier)} avg</span><span>You vs {tierName(g.nextTier)} avg</span><span>z</span>
            </div>
            {g.rows.map((r) => {
              const def = STAT_DEFS.find((d) => d.key === r.key);
              // your average as a share of the next rank's average (inverted stats reversed);
              // tick = where YOUR rank's average sits on the same scale
              const ratio = (a, b) => (b > 1e-9 ? Math.max(0, Math.min(1, a / b)) : 0);
              const fill = r.invert ? ratio(r.next, r.mine) : ratio(r.mine, r.next);
              const tick = r.invert ? ratio(r.next, r.cur) : ratio(r.cur, r.next);
              return (
                <div key={r.key} className="gap-row" title={def?.desc || r.key}>
                  <span className="gap-label">{def?.label || r.key}{r.invert ? ' ↓' : ''}</span>
                  <span className="gap-mine">{fmtV(r.mine, def)}</span>
                  <span className="gap-cur">{fmtV(r.cur, def)}</span>
                  <span className="gap-next">{fmtV(r.next, def)}</span>
                  <span className="gap-track">
                    <span className="gap-fill" style={{ width: `${fill * 100}%` }} />
                    <span className="gap-tick" style={{ left: `${tick * 100}%` }} title={`${g.myBucket.replace('-', ' ')} average sits here`} />
                  </span>
                  <span className="gap-z">{r.z.toFixed(1)}</span>
                </div>
              );
            })}
            <div className="footnote" style={{ marginTop: 10 }}>
              Bar = your average as a share of the {g.nextBucket.replace('-', ' ')} average (full bar = at their level; ↓ stats compared inverted).
              The thin marker = where your current rank&apos;s average sits on the same scale. z = deficit ÷ next-rank standard deviation — bigger z, bigger gap.
            </div>
          </div>
        );
      })()}

      {/* ===== COACHING: focus + action plan + strengths ===== */}
      {p.coaching && (() => {
        const baseLeaks = p.coaching.leaks?.length
          ? p.coaching.leaks
          : [p.coaching.mainLeak, p.coaching.secondLeak].filter(Boolean);
        // top up with the worst percentiles (not already covered by leaks) to 8 items
        const covered = new Set(baseLeaks.flatMap((l) => LEAK_COVERS[l.title] || []));
        const { weaknesses } = strengthsWeaknesses(p.percentiles || {}, teamMode);
        const extras = weaknesses
          .filter((w) => !covered.has(w.key) && WEAK_ADVICE[w.key])
          .map((w) => ({
            title: w.label,
            diag: `${ord(w.pct)} percentile among ${p.percentileSource || 'players in your matches'}`,
            advice: WEAK_ADVICE[w.key],
          }));
        const leaks = [...baseLeaks, ...extras].slice(0, 8);
        return (
          <div className="coach-row">
            <div className="card coach-panel">
              <div className="sheet-h" style={{ color: 'var(--red)' }}>Focus — top 3 leaks</div>
              {leaks[0] ? (
                <>
                  <div className="leak-title small">1. {leaks[0].title}</div>
                  <div className="leak-diag" style={{ margin: '6px 0 10px' }}>{leaks[0].diag}</div>
                  <div className="leak-advice">{leaks[0].advice}</div>
                  {leaks.slice(1, 3).map((l, i) => (
                    <div key={l.title} className="plan-item" style={{ marginTop: i === 0 ? 12 : 0 }}>
                      <span className="plan-num" style={{ color: 'var(--red)', background: 'rgba(242,109,109,0.09)' }}>{i + 2}</span>
                      <span><b>{l.title}</b> · <span className="rank-note">{l.diag}</span><br /><span className="plan-tip">{l.advice}</span></span>
                    </div>
                  ))}
                </>
              ) : <div className="rank-note">no significant issues — keep it up</div>}
            </div>
            <div className="card coach-panel">
              <div className="sheet-h" style={{ color: 'var(--gold)' }}>Action plan</div>
              {leaks.length > 3 ? leaks.slice(3).map((l, i) => (
                <div key={l.title} className="plan-item">
                  <span className="plan-num">{i + 4}</span>
                  <span><b>{l.title}</b> · <span className="rank-note">{l.diag}</span><br /><span className="plan-tip">{l.advice}</span></span>
                </div>
              )) : <div className="rank-note">nothing else stands out — work through the focus list</div>}
            </div>
            <div className="card coach-panel">
              <div className="sheet-h" style={{ color: 'var(--green)' }}>Keep doing</div>
              {p.coaching.strengths.length
                ? p.coaching.strengths.map((s) => <span key={s} className="strength-chip">✓ {s}</span>)
                : <div className="rank-note">no standout strengths yet</div>}
              {p.coaching.avgGameScore != null && (
                <div className="rank-note" style={{ marginTop: 12 }}>
                  Form (avg game rating): <b style={{ color: 'var(--text)' }}>{p.coaching.avgGameScore.toFixed(0)}</b> / 99 · last {p.coaching.sample} games
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ===== STRENGTHS / WEAKNESSES ===== */}
      {p.percentiles && (() => {
        const { strengths, weaknesses } = strengthsWeaknesses(p.percentiles, teamMode);
        if (!strengths.length && !weaknesses.length) return null;
        return (
          <div className="sw-grid">
            <div className="card sw-panel">
              <div className="sheet-h" style={{ color: '#6FFF00' }}>Strengths</div>
              {strengths.length ? strengths.map((s) => (
                <div key={s.key} className="srow">
                  <span className="slbl">{s.label}</span>
                  <span className="sval">{s.pct}th pct</span>
                  <span className="spct"><span className="pbar"><span className="pfill hi" style={{ width: s.pct + '%' }} /></span></span>
                </div>
              )) : <div className="rank-note">nothing stands out above the 70th percentile</div>}
            </div>
            <div className="card sw-panel">
              <div className="sheet-h" style={{ color: '#ff6d6d' }}>Weaknesses</div>
              {weaknesses.length ? weaknesses.map((s) => (
                <div key={s.key} className="srow">
                  <span className="slbl">{s.label}</span>
                  <span className="sval">{s.pct}th pct</span>
                  <span className="spct"><span className="pbar"><span className="pfill lo" style={{ width: Math.max(6, s.pct) + '%' }} /></span></span>
                </div>
              )) : <div className="rank-note">no stats below the 30th percentile</div>}
            </div>
          </div>
        );
      })()}

      {/* ===== STAT SHEET (FBref-style) ===== */}
      <h2 className="section-title"><span className="accent">▮</span> Per-game statistics — {modeLabel}
        {p.percentiles && (
          <span className="sheet-note">
            bar = percentile vs {p.percentileSource || 'players from your matches'}
            {p.percentileSample ? ` (n=${p.percentileSample})` : ''}
          </span>
        )}
      </h2>
      <div className="sheet">
        {SHEET.map((cat) => (
          <div key={cat.title} className="sheet-panel card">
            <div className="sheet-h">{cat.title}</div>
            {cat.rows.map((row) => {
              const pctVal = row.pctKey && pc[row.pctKey] != null ? pc[row.pctKey] : null;
              return (
                <div key={row.label} className="srow" title={pctVal != null ? `Better than ${pctVal}% of players` : undefined}>
                  <span className="slbl">{row.label}</span>
                  <span className="sval">
                    {row.dec == null ? row.value : Number(row.value).toFixed(row.dec)}{row.suffix}
                  </span>
                  <span className="spct">
                    {pctVal != null ? (
                      <span className="pbar"><span className={`pfill ${pctVal >= 65 ? 'hi' : pctVal >= 35 ? 'mid' : 'lo'}`} style={{ width: pctVal + '%' }} /></span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ===== RANK + COMPARISONS ===== */}
      <h2 className="section-title"><span className="accent">▮</span> Rank & performance — {modeLabel}
        {isMe && <button className="trn-refresh" onClick={refreshRank}>{trn?.loading ? '…' : 'Refresh (Tracker)'}</button>}
      </h2>
      <div className="rank-row">
        <div className="rank-panel card">
          {mode ? (
            <div className="rank-cols">
              <div className="rank-col">
                <div className="rank-cap">Actual rank</div>
                {shownTier != null ? (
                  <>
                    <RankBadge tier={shownTier} size="lg" />
                    <div className="rank-note">
                      {p.rank.replayTier != null ? 'from a ranked replay'
                        : trnTier != null ? <>{p.rank.trn.division}{p.rank.trn.mmr ? ` · ${p.rank.trn.mmr} MMR` : ''}{p.rank.trn.matches ? ` · ${p.rank.trn.matches} matches` : ''}{p.rank.trn.winStreak > 1 ? ` · ${p.rank.trn.winStreak}W streak` : ''}</>
                        : 'manual entry'}
                    </div>
                    {(p.rank.trn?.seasonPeak || p.rank.trn?.peak?.mmr) && (
                      <div className="peak-line">
                        {p.rank.trn.seasonPeak && <span>Season peak: <b>{p.rank.trn.seasonPeak}</b></span>}
                        {p.rank.trn.peak?.mmr && <span>All-time: <b>{p.rank.trn.peak.mmr}</b>{p.rank.trn.peak.tierName ? ` (${p.rank.trn.peak.tierName})` : ''}</span>}
                      </div>
                    )}
                  </>
                ) : isMe ? (
                  <>
                    <select className="rank-select" value={p.rank.manualTier ?? ''} onChange={(e) => setManualTier(e.target.value)}>
                      <option value="">— select your rank —</option>
                      {ALL_TIERS.map((t, i) => i > 0 && <option key={i} value={i}>{t.name}</option>)}
                    </select>
                    <div className="rank-note">rank not found on tracker.gg → enter manually</div>
                  </>
                ) : <div className="rank-note">rank not fetched yet</div>}
              </div>
              <div className="rank-col">
                <div className="rank-cap">Performance (estimate)</div>
                {p.rank.estTierRecent != null ? (
                  <><RankBadge tier={p.rank.estTierRecent} size="lg" estimate />
                    <div className="rank-note">
                      last 8 games · career {tierName(p.rank.estTierAvg)}
                      {p.rank.estSource === 'gbdt' && <> · <span style={{ color: 'var(--accent)' }} title="Gradient-boosted trees trained on the ballchasing corpus, calibrated to tracker.gg ranks">GBDT model</span></>}
                      {p.rank.estSource === 'benchmark' && <> · <span style={{ color: 'var(--accent)' }}>benchmark model</span></>}
                    </div></>
                ) : <div className="rank-note">not enough data</div>}
                {rankDelta != null && (
                  <div className={`verdict mini ${rankDelta > 1 ? 'up' : rankDelta < -1 ? 'down' : 'even'}`}>
                    {rankDelta > 1 ? `+${rankDelta.toFixed(1)} tiers above rank` : rankDelta < -1 ? `${rankDelta.toFixed(1)} tiers below rank` : 'at rank level'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rank-mini-grid">
              {['1', '2', '3'].map((m) => {
                const t = trn?.playlists?.[m];
                const mp = modeProfiles[m];
                const est = mp?.rank?.estTierRecent;
                const d = t?.tier != null && est != null ? est - t.tier : null;
                return (
                  <div key={m} className="rank-mini">
                    <div className="rank-cap">{m}v{m}</div>
                    <div className="rank-mini-row">
                      <span className="rank-mini-lbl">Rank:</span>
                      {t?.tier != null ? <RankBadge tier={t.tier} size="sm" /> : <span className="rank-note">{mp ? '—' : 'no matches'}</span>}
                    </div>
                    {t?.mmr && <div className="rank-note">{t.mmr} MMR{t.matches ? ` · ${t.matches} matches` : ''}</div>}
                    {trn?.peaks?.[m]?.mmr && <div className="rank-note">Peak: <b style={{ color: '#EFF4FF' }}>{trn.peaks[m].mmr}</b>{trn.peaks[m].tierName ? ` (${trn.peaks[m].tierName})` : ''}</div>}
                    <div className="rank-mini-row">
                      <span className="rank-mini-lbl">Perf:</span>
                      {est != null ? <RankBadge tier={est} size="sm" estimate /> : <span className="rank-note">—</span>}
                    </div>
                    {d != null && (
                      <div className={`verdict mini ${d > 1 ? 'up' : d < -1 ? 'down' : 'even'}`}>
                        {d > 1 ? `+${d.toFixed(1)}` : d < -1 ? `−${Math.abs(d).toFixed(1)}` : 'at rank'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {mode && trend.length > 2 && (
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={trend}>
                <CartesianGrid stroke="rgba(239,244,255,0.07)" vertical={false} />
                <XAxis dataKey="i" tick={{ fill: '#7e88ab', fontSize: 11 }} />
                <YAxis domain={[0, 22]} ticks={[2, 8, 14, 20]} width={80}
                  tick={{ fill: '#7e88ab', fontSize: 10.5 }} tickFormatter={(v) => tierName(v).replace('Grand Champion', 'GC')} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(i) => 'Game #' + i}
                  formatter={(v, n) => [typeof v === 'number' ? tierName(v) + ` (${v.toFixed(1)})` : v, n]} />
                <Line dataKey="estTier" name="Performance" stroke="#55a3f5" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                {shownTier != null && <ReferenceLine y={shownTier} stroke="#ffd166" strokeDasharray="6 4" />}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {benchmark && (
          <div className="cmp-wrap card">
            <div className="sheet-h">You vs. your rank — and the next one</div>
            <table className="cmp">
              <thead>
                <tr>
                  <th></th><th>You</th>
                  <th style={{ color: '#7e88ab' }}>{benchmark.tierName}</th><th>Δ</th>
                  {benchmark.nextTier != null && <><th style={{ color: 'var(--accent)' }}>{tierName(benchmark.nextTier)}</th><th>Δ</th></>}
                </tr>
              </thead>
              <tbody>
                {benchmark.rows.map((r) => (
                  <tr key={r.label}>
                    <td className="stat-name">{r.label}</td>
                    <td style={{ fontWeight: 600 }}>{r.mine}</td>
                    <td style={{ color: '#7e88ab' }}>{r.expected}</td>
                    <td style={{ color: r.diffPct >= 0 ? '#6FFF00' : '#ff6d6d', fontWeight: 600 }}>{r.diffPct >= 0 ? '+' : ''}{r.diffPct}%</td>
                    {benchmark.nextTier != null && <>
                      <td style={{ color: '#7e88ab' }}>{r.expectedNext}</td>
                      <td style={{ color: r.diffNextPct >= 0 ? '#6FFF00' : '#ff6d6d', fontWeight: 600 }}>{r.diffNextPct >= 0 ? '+' : ''}{r.diffNextPct}%</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
            {benchmark.nextTier != null && (
              <div className="footnote">Red in the last column = what to improve to play like {tierName(benchmark.nextTier)}</div>
            )}
          </div>
        )}

        {isMe && trn?.lifetime && (
          <div className="card sheet-panel">
            <div className="sheet-h">Tracker · lifetime</div>
            {[
              ['Wins', trn.lifetime.wins], ['Goals', trn.lifetime.goals], ['Saves', trn.lifetime.saves],
              ['Assists', trn.lifetime.assists], ['MVPs', trn.lifetime.mvps],
              ['Shooting %', trn.lifetime.goalShotRatio + '%'],
              ...(trn.casualMmr ? [['Casual MMR', trn.casualMmr]] : []),
              ...(trn.lifetime.seasonRewardLevel != null ? [['Season reward', ['—', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'GC'][trn.lifetime.seasonRewardLevel]]] : []),
            ].map(([l, v]) => (
              <div key={l} className="srow"><span className="slbl">{l}</span><span className="sval">{typeof v === 'number' ? v.toLocaleString('en-GB') : v}</span><span /></div>
            ))}
          </div>
        )}
      </div>

      {/* ===== PERSONAL RECORDS ===== */}
      {p.records && (
        <>
          <h2 className="section-title"><span className="accent">▮</span> Personal records — {modeLabel}</h2>
          <div className="kpi-grid">
            {[
              ['Fastest goal', p.records.fastestGoal, (r) => fmtDur(r.v)],
              ['Most goals', p.records.mostGoals, (r) => r.v],
              ['Most saves', p.records.mostSaves, (r) => r.v],
              ['Best score', p.records.mostScore, (r) => r.v],
              ['Best rating', p.records.bestRating, (r) => r.v],
              ['Longest win streak', p.records.longestWinStreak ? { v: p.records.longestWinStreak } : null, (r) => 'W' + r.v],
              ['Biggest comeback', p.records.biggestComeback, (r) => '−' + r.v + ' → win'],
              ['Longest match', p.records.longestMatch, (r) => fmtDur(r.v)],
            ].filter(([, r]) => r).map(([label, r, fmt]) => {
              const inner = (
                <div className="stat-card" style={{ cursor: r.matchId ? 'pointer' : 'default' }}>
                  <div className="val">{fmt(r)}</div>
                  <div className="lbl">{label}</div>
                  {r.date && <div className="sub">{fmtDate(r.date)}</div>}
                </div>
              );
              return r.matchId
                ? <Link key={label} to={`/match/${encodeURIComponent(r.matchId)}`}>{inner}</Link>
                : <div key={label}>{inner}</div>;
            })}
          </div>
        </>
      )}

      {/* ===== FORM ===== */}
      <h2 className="section-title"><span className="accent">▮</span> Form over time</h2>
      <div className="chart-grid">
        {trend.some((t) => t.rating != null) && (
          <div className="card chart-card">
            <h4>Game rating (1–99) · 5-game average</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend.map((t, i) => {
                const w = trend.slice(Math.max(0, i - 4), i + 1).map((x) => x.rating).filter((v) => v != null);
                return { ...t, roll: w.length ? Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 10) / 10 : null };
              })}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="i" tick={{ fill: '#7e88ab', fontSize: 11 }} />
                <YAxis domain={[0, 99]} ticks={[25, 50, 75]} tick={{ fill: '#7e88ab', fontSize: 11 }} width={30} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(i) => 'Game #' + i} />
                <ReferenceLine y={50} stroke="rgba(255,255,255,0.15)" strokeDasharray="5 4" />
                <Line dataKey="rating" name="Rating" stroke="rgba(111,255,0,0.45)" strokeWidth={1.5} dot={{ r: 2.5 }} connectNulls>
                </Line>
                <Line dataKey="roll" name="5-game avg" stroke="#6FFF00" strokeWidth={2.5} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {p.kickoffs && (p.kickoffs.won + p.kickoffs.lost + p.kickoffs.neutral) > 0 && (
          <div className="card chart-card">
            <h4>Kickoffs</h4>
            <div className="poss-bar" style={{ height: 22, fontSize: 11.5, marginBottom: 12 }}>
              <div className="p0" style={{ width: `${(p.kickoffs.won / (p.kickoffs.won + p.kickoffs.lost + p.kickoffs.neutral)) * 100}%` }}>{p.kickoffs.won} W</div>
              <div style={{ background: 'rgba(255,255,255,0.12)', width: `${(p.kickoffs.neutral / (p.kickoffs.won + p.kickoffs.lost + p.kickoffs.neutral)) * 100}%`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}>{p.kickoffs.neutral}</div>
              <div className="p1" style={{ background: 'linear-gradient(90deg, #b0472f, #d95f3d)' }}>{p.kickoffs.lost} L</div>
            </div>
            {[
              ['Kickoff win %', p.kickoffs.winPct != null ? p.kickoffs.winPct + '%' : '—'],
              ['First touch %', p.kickoffs.firstTouchPct + '%'],
              ['Goals for off kickoff (≤10 s)', `${p.kickoffs.goalsForOffKickoff} (${p.kickoffs.perGameFor}/gm)`],
              ['Conceded off kickoff (≤10 s)', `${p.kickoffs.goalsAgainstOffKickoff} (${p.kickoffs.perGameAgainst}/gm)`],
            ].map(([l, v]) => (
              <div key={l} className="srow" style={{ gridTemplateColumns: '1fr auto' }}>
                <span className="slbl">{l}</span><span className="sval">{v}</span>
              </div>
            ))}
            <div className="footnote">Off-kickoff goals detected from goal times (≤10 s after play restarts)</div>
          </div>
        )}
        <div className="card chart-card">
          <h4>Goals · saves · shots</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend}>
              <CartesianGrid stroke="rgba(239,244,255,0.07)" vertical={false} />
              <XAxis dataKey="i" tick={{ fill: '#7e88ab', fontSize: 11 }} />
              <YAxis tick={{ fill: '#7e88ab', fontSize: 11 }} width={28} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(i) => 'Game #' + i} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="goals" name="Goals" radius={[3, 3, 0, 0]}>
                {trend.map((t, i) => <Cell key={i} fill={t.win > 0 ? '#6FFF00' : '#55a3f5'} />)}
              </Bar>
              <Bar dataKey="saves" name="Saves" fill="#a78bfa" radius={[3, 3, 0, 0]} />
              <Bar dataKey="shots" name="Shots" fill="rgba(240,154,82,0.55)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h4>Score per game</h4>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="scoreG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#55a3f5" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#55a3f5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(239,244,255,0.07)" vertical={false} />
              <XAxis dataKey="i" tick={{ fill: '#7e88ab', fontSize: 11 }} />
              <YAxis tick={{ fill: '#7e88ab', fontSize: 11 }} width={40} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(i) => 'Game #' + i} />
              <Area dataKey="score" name="Score" stroke="#55a3f5" strokeWidth={2} fill="url(#scoreG)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {isMe && mmrHistory.length >= 2 && (
          <div className="card chart-card">
            <h4>MMR over time</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={mmrHistory.map((h) => ({ ...h, d: new Date(h.fetched_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }))}>
                <CartesianGrid stroke="rgba(239,244,255,0.07)" vertical={false} />
                <XAxis dataKey="d" tick={{ fill: '#7e88ab', fontSize: 11 }} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#7e88ab', fontSize: 11 }} width={44} />
                <Tooltip contentStyle={tooltipStyle}
                  formatter={(v, n, e) => [v + ' MMR (' + tierName(e.payload.tier) + ')', e.payload.mode + 'v' + e.payload.mode]} />
                {mode
                  ? <Line dataKey="mmr" name="MMR" stroke="#55a3f5" strokeWidth={2.5} dot={{ r: 3 }} />
                  : ['1', '2', '3'].map((mm, i) => (
                    <Line key={mm} data={mmrHistory.filter((h) => h.mode === mm).map((h) => ({ ...h, d: new Date(h.fetched_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }))}
                      dataKey="mmr" name={mm + 'v' + mm} stroke={['#55a3f5', '#6FFF00', '#a78bfa'][i]} strokeWidth={2} dot={{ r: 2.5 }} />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="card chart-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h4 style={{ alignSelf: 'flex-start' }}>Position heatmap</h4>
          <FieldHeatmap grid={p.heatmap} width={270} />
        </div>
        {p.rolePos && teamMode && (
          <div className="card chart-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h4 style={{ alignSelf: 'flex-start' }}>Rotation map — avg position per role</h4>
            <RotationMap rolePos={p.rolePos} width={270} />
            <div className="footnote" style={{ alignSelf: 'flex-start' }}>
              Where you sit when you are 1st / 2nd / last man · arrows show the rotation loop · own goal at bottom
            </div>
          </div>
        )}
      </div>

      {/* ===== RECENT MATCHES ===== */}
      <h2 className="section-title"><span className="accent">▮</span> Recent matches</h2>
      <div className="match-list grid2">
        {matches.map((m) => <MiniMatch key={m.id} m={m} />)}
      </div>
      <p style={{ marginTop: 14 }}><Link to="/matches" style={{ color: 'var(--accent)', fontSize: 14 }}>All matches →</Link></p>
    </>
  );
}

function MiniMatch({ m }) {
  const win = m.me?.win > 0;
  return (
    <Link to={`/match/${encodeURIComponent(m.id)}`} className={`match-card ${win ? 'win' : 'loss'}`}>
      <div className="edge" />
      <div>
        <div className="match-score">
          <span className="b">{m.team0_score}</span><span className="sep">:</span><span className="o">{m.team1_score}</span>
        </div>
        <div className="match-result-tag">{win ? 'WIN' : 'LOSS'}</div>
      </div>
      <div className="match-info">
        <div className="map">{m.map}</div>
        <div className="meta">
          <span>{fmtDate(m.date)}</span>
          <span className="badge mode">{m.team_size}v{m.team_size}</span>
          {m.overtime && <span className="badge ot">OT</span>}
          {m.me?.mvp && <span className="badge mvp">MVP</span>}
        </div>
      </div>
      {m.me && (
        <div className="match-mystats">
          <div className="ms"><div className="n">{m.me.goals}</div><div className="t">Goals</div></div>
          <div className="ms"><div className="n">{m.me.assists}</div><div className="t">Assists</div></div>
          <div className="ms"><div className="n">{m.me.saves}</div><div className="t">Saves</div></div>
          <div className="ms"><div className="n">{m.me.score}</div><div className="t">Score</div></div>
          {m.me.gameScore != null && (
            <div className="ms">
              <div className={`n rating-num ${m.me.gameScore >= 70 ? 'hi' : m.me.gameScore >= 45 ? 'mid' : 'lo'}`}>{m.me.gameScore}</div>
              <div className="t">Rating</div>
            </div>
          )}
        </div>
      )}
      <div style={{ color: '#4d5678' }}>›</div>
    </Link>
  );
}
