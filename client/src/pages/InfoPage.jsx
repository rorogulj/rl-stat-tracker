import { useMemo, useState } from 'react';
import { STAT_DEFS } from '../statDefs.js';
import Scribble from '../components/Scribble.jsx';

/**
 * INFO / WIKI page — explains every number, model and term in the app.
 * RULE: every new or changed stat/feature/model MUST get (or update)
 * its entry here. Statistics are pulled from STAT_DEFS (desc + math),
 * so for those it's enough to maintain statDefs.js.
 */

const CONCEPTS = [
  {
    term: 'Game rating (1–99)', cat: 'Ratings',
    body: 'The number next to every player in every match. Three layers: 55% performance vs your own lobby (z-scores of 5 components against the other players in that match), 30% absolute production (z-score vs the entire database for that mode), 15% match impact (share of team goals, win/margin ±12, clutch bonus for OT or late equal-score goals). Clean sheets floor the defense component at 58; shortened lobbies (leavers) scale possession/touch stats. Computed on the fly — old replays never need reimporting.',
  },
  {
    term: 'Rating components (Attack / Defense / Possession / Boost / Pressure)', cat: 'Ratings',
    body: 'The five axes of the profile radar. Each is a per-match z-score vs the lobby, averaged over your games: Attack (goals, xG, shots, finishing), Defense (saves, clears, goalside positioning — weight grows with rank), Possession (touches, possession %, turnovers), Boost (economy, stolen pads, time at zero), Pressure (territory, demos, 50/50s, clutch moments). The dashed ring at 50 on the radar = the average player from your lobbies.',
  },
  {
    term: 'Form', cat: 'Ratings',
    body: 'Average game rating over your recent games (shown in the profile hero). 50 = average for your lobbies; above 55 is a good run.',
  },
  {
    term: 'Performance estimate (per match)', cat: 'Models',
    body: 'The "Perf. estimate" column in a match: the benchmark model reads that single game\'s 34 stats against rank centroids, then shrinks toward the lobby prior (average known rank of the lobby): 0.45·estimate + 0.55·prior, clamped to prior±2.5 tiers. One great game in a Champ lobby therefore cannot read as SSL. The unshrunk value feeds the smurf detector.',
  },
  {
    term: 'Model estimate (GBDT)', cat: 'Models',
    body: 'The profile\'s learned rank estimate. A pure-JS gradient-boosted-trees model (LightGBM-style: histogram splits, 32 bins, depth ≤5, up to 400 trees with early stopping) trained on the ballchasing benchmark corpus — 34 stats per player-game → rank tier 2–22. Validation is split by match so teammates never leak between train and val. Predictions are calibrated to tracker.gg using players from YOUR matches with known real ranks (linear fit, ≥8 pairs for slope). Retrains automatically when the corpus grows >5%. Status on the Server page.',
  },
  {
    term: 'Centroid model (benchmark archetype, ladder)', cat: 'Models',
    body: 'The simpler sibling of the GBDT: each rank bucket\'s mean/σ per stat forms a centroid; your averages get a z-distance to every centroid and a softmax (T=1.2) turns distances into a weighted tier. The Ladder\'s "Benchmark archetype" card runs it per stat CATEGORY (attack/defense/rotation/possession/boost/movement) to say things like "you attack like Diamond I". Its overall is anchored to the calibrated GBDT so both models agree.',
  },
  {
    term: 'Session form', cat: 'Models',
    body: 'The capsule under your name: the GBDT model\'s read of your LAST calendar day of play (same session definition as the Matches page), shown as a rank icon with the number of games.',
  },
  {
    term: 'Gap to next rank', cat: 'Models',
    body: 'Your last 20 games vs the benchmark averages of the NEXT SUB-RANK (Champ 1 → Champ 2). Benchmark centroids exist per whole rank (8 buckets), so the centroid for an in-between tier is linearly interpolated between bucket anchors. Rows are sorted by z = deficit/σ — how many standard deviations you trail the next rank\'s average. The bar shows your average as a share of the next rank\'s average; the gold tick marks where your CURRENT rank\'s average sits.',
  },
  {
    term: 'Percentiles (profile sheets)', cat: 'Models',
    body: 'Per-stat percentile bars. Source depends on data available: "vs champion players (ballchasing)" once the benchmark bucket for your rank has ≥200 player-rows, otherwise vs all players from your own matches. Green ≥65th, gold 35–65th, red <35th.',
  },
  {
    term: 'Benchmark corpus (ballchasing)', cat: 'Models',
    body: 'A stratified sample of ranked replays downloaded from ballchasing.com — target 1000 (2v2) / 1600 (1v1) / 800 (3v3) matches per rank bucket, current season only. Every replay runs through the same analyzer as your games, so numbers are directly comparable. Personal queries always exclude benchmark data. Download progress lives on the Server page.',
  },
  {
    term: 'xG (expected goals)', cat: 'Match analysis',
    body: 'Each detected shot gets a probability of scoring from distance, angle, speed, open-goal factor and defenders on the shot line at the moment of the shot, calibrated on real shots (Platt scaling). Note: this is an "on-frame" xG (xGOT semantics — would it go in if not saved), so average conversion is ~50%, higher than broadcast-football xG.',
  },
  {
    term: 'Key stats (match page)', cat: 'Match analysis',
    body: 'Where this match stood out from YOUR average: stats deviating ±20% or more from your career per-game average in that mode, top 7, green = better, red = worse.',
  },
  {
    term: 'Key factors / Why X won', cat: 'Match analysis',
    body: 'Twelve candidate explanations (finishing vs xG, chances created, goalkeeping, rotation errors, kickoff goals, territory, ball security, 50/50s, demos, boost starvation, OT/late winner, comeback) are scored for the winning team; the top ones render as cards with an impact meter.',
  },
  {
    term: 'Momentum graph', cat: 'Match analysis',
    body: 'Field tilt as an exponential moving average plus goal impulses — who controlled which phase of the game. Blue above the line, orange below; dots mark goals.',
  },
  {
    term: 'Field tilt', cat: 'Match analysis',
    body: 'Share of play spent in each half, measured by ball position over time. 50% = even game.',
  },
  {
    term: 'Kickoff win %', cat: 'Match analysis',
    body: 'A kickoff is "won" if your team gets the ball into the opponent half (or first meaningful touch advantage). Both the first toucher AND the nearest opponent get graded, so the league average is ~50% by construction (symmetric duel).',
  },
  {
    term: '50/50 win %', cat: 'Match analysis',
    body: 'Challenges where two players contest the ball at similar distance — won if your team keeps or advances possession. Symmetric: every win is someone\'s loss, league average ~50%.',
  },
  {
    term: 'Rotation map', cat: 'Match analysis',
    body: 'Average position per role (1st / 2nd / last man, normalized "my goal at the bottom"), circle radius = share of time in that role, arrows sketch the rotation loop.',
  },
  {
    term: 'Playstyle axes', cat: 'Profile',
    body: 'Six 0–100 axes computed per game and averaged: Attack, Defense, Control (ball security), Speed (tempo/supersonic), Aerial (air presence), Duels (50/50s + kickoffs). They drive the modifier tags and feed the archetype description.',
  },
  {
    term: 'Modifiers (aerial, fast, technical, turnover-prone, strong in duels)', cat: 'Profile',
    body: 'Threshold tags on the playstyle axes: aerial ≥55, fast = speed ≥62, technical = control ≥65, turnover-prone = control ≤35, strong in duels = duels ≥62.',
  },
  {
    term: 'Chemistry (Teammates tab)', cat: 'Players',
    body: 'Your win % together with that teammate minus your overall win % in the mode. Positive = you win more with them than usual.',
  },
  {
    term: 'Your rating with', cat: 'Players',
    body: 'Your average game rating in matches with that teammate, with the delta vs your overall average in brackets.',
  },
  {
    term: 'Smurf detection', cat: 'Players',
    body: 'Flags accounts whose performance estimate sits far above their account\'s visible rank, with few tracked matches or fresh accounts as supporting signals. The unshrunk per-game estimate (estTierRaw) feeds this.',
  },
  {
    term: 'Favorite players', cat: 'Players',
    body: 'Star (☆) a player on their profile to save them; they get their own tab on the Players page and a gold ★ everywhere they appear. Stored locally in the database.',
  },
  {
    term: 'Rank sources & caching', cat: 'Players',
    body: 'Real ranks come from tracker.gg: your own rank refreshes hourly, other players every 30 days (cache is never deleted, TTL only controls refresh). Fetches respect rate limits with cooldowns; "Fetch actual ranks" on a match forces a retry. Estimated ranks (~) come from the GBDT/centroid models instead.',
  },
  {
    term: 'Sessions', cat: 'Matches',
    body: 'A session = one calendar day of play. The Matches page shows the last three with W/L dots, rating sparkline and a tilt warning when your form drops sharply within the session.',
  },
  {
    term: 'Personal records', cat: 'Profile',
    body: 'Fastest goal, most goals/saves in a game, best score, best rating, longest win streak, biggest comeback, longest match — each clickable to the match it happened in.',
  },
  {
    term: 'Welcome screen (no server)', cat: 'App',
    body: 'The interface needs the local tracker server (localhost:7845). If /api/status does not answer — public demo deployment, or the server simply is not running — a landing screen appears instead of the app, with setup steps and a GitHub link. It re-checks every 5 seconds and loads the app automatically once the server comes up.',
  },
  {
    term: 'Updates (↑ button)', cat: 'App',
    body: 'The server compares its version against GitHub once per session (6 h cache). When a newer version exists, an ↑ vX.Y.Z button appears in the top bar: one click re-runs the installer, the server replaces itself and restarts, and the page reloads on its own. Updates install the tagged release snapshot, never the moving tip of the repo, and nothing ever installs without your click. Current state is always visible on the Server tab ("Updates" row, with a manual Check now). Your database is untouched (it lives outside the app folder). Git checkouts update via git pull instead; RL_NO_UPDATE_CHECK=1 disables checking entirely.',
  },
  {
    term: 'Published rank models', cat: 'App',
    body: 'The GBDT rank models are trained on a large benchmark corpus that regular installs do not have. Trained models are therefore published to GitHub (server/models) and every install checks daily for a newer one, downloads it silently and starts using it — rank estimates improve without any user action. A locally trained model (if you built your own corpus) always wins if it is newer.',
  },
];

// must mirror computeArchetype in server/src/aggregate.js
const ARCHETYPES = [
  ['Striker', 'Finishes plays: high goals and shots per game with strong conversion.', 'goals/game, shots/game, shooting %'],
  ['Playmaker', 'Creates more than they finish — assists rival goals, high possession and constant touches. 2v2/3v3 only.', 'assists÷goals ratio, possession %, touches/min'],
  ['Ballchaser', 'First to every ball, low time behind the ball, relentless pressure — not much patience for sitting back.', 'touches/min, LOW % behind ball, double commits (or supersonic in 1v1)'],
  ['Lawnmower', 'Owns the floor: supersonic on the ground, rarely airborne.', '% on ground, % supersonic, LOW aerial touches'],
  ['Aerial ace', 'Lives in the air — aerial touches, high-air time, flip resets.', 'aerial touches/game, % high air, flip resets'],
  ['The Wall', 'The last line: saves, clears, permanent goalside presence.', 'saves/game, % behind ball, clears/game'],
  ['Demo merchant', 'Plays the man as much as the ball — demos break the opponent\'s structure.', 'demos/game, % supersonic'],
  ['Boost scavenger', 'Starves opponents of resources: steals their big pads and the ball.', 'big pads stolen/game, steals/game'],
  ['Kickoff bully', 'Wins the first three seconds over and over.', 'kickoff win %, kickoff first-touch %'],
  ['All-rounder', 'No single dimension dominates — the fallback when no candidate scores ≥ 0.45.', '—'],
];

export default function InfoPage() {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const hit = (...texts) => !needle || texts.some((t) => (t || '').toLowerCase().includes(needle));

  const concepts = useMemo(() => CONCEPTS.filter((c) => hit(c.term, c.body, c.cat)), [needle]);
  const archs = useMemo(() => ARCHETYPES.filter(([n, d, s]) => hit(n, d, s, 'archetype')), [needle]);
  const stats = useMemo(() => STAT_DEFS.filter((d) => hit(d.label, d.desc, d.math, d.cat, d.key)), [needle]);

  const catGroups = useMemo(() => {
    const g = new Map();
    for (const c of concepts) {
      if (!g.has(c.cat)) g.set(c.cat, []);
      g.get(c.cat).push(c);
    }
    return [...g.entries()];
  }, [concepts]);

  const statCats = useMemo(() => {
    const g = new Map();
    for (const d of stats) {
      const cat = d.cat || 'Other';
      if (!g.has(cat)) g.set(cat, []);
      g.get(cat).push(d);
    }
    return [...g.entries()];
  }, [stats]);

  const total = concepts.length + archs.length + stats.length;

  return (
    <>
      <h2 className="section-title">Info <Scribble>the wiki</Scribble>
        <span className="sheet-note">every number on this site, explained · {total} entries{needle ? ' matching' : ''}</span>
      </h2>

      <input
        className="search-input wiki-search" style={{ width: 340, marginBottom: 22 }}
        placeholder="Search a term… (e.g. xG, chemistry, GBDT, lawnmower)"
        value={q} onChange={(e) => setQ(e.target.value)} autoFocus
      />

      {total === 0 && <div className="empty"><h3>No entries match "{q}"</h3></div>}

      {catGroups.map(([cat, items]) => (
        <div key={cat}>
          <div className="dsection-h" style={{ marginTop: 30 }}>{cat}</div>
          <div className="info-grid">
            {items.map((c) => (
              <div key={c.term} className="card info-card">
                <div className="info-term">{c.term}</div>
                <p className="info-body">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {archs.length > 0 && (
        <>
          <div className="dsection-h" style={{ marginTop: 30 }}>Archetypes</div>
          <p className="footnote" style={{ marginTop: 0, marginBottom: 12 }}>
            Computed from your per-game averages: each archetype scores 0–1, where the lower bound of every range is the
            ballchasing-corpus average FOR YOUR MODE (so a typical player scores ~0, a distinctive profile 0.5+; e.g. 1v1
            "goals/game" is measured against the 1v1 average of ~3.8, not the 2v2 average of ~1.3). The highest score ≥ 0.35
            wins; a second one ≥ 0.35 shows as "with a hint of…". Assist-based archetypes are disabled in 1v1.
            Shown on your profile hero and in the Players tables (≥2 shared games).
          </p>
          <div className="info-grid">
            {archs.map(([name, desc, signals]) => (
              <div key={name} className="card info-card">
                <div className="info-term" style={{ color: 'var(--neon)' }}>{name}</div>
                <p className="info-body">{desc}</p>
                <p className="info-signals">Signals: {signals}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {statCats.length > 0 && (
        <>
          <div className="dsection-h" style={{ marginTop: 34 }}>Statistics</div>
          <p className="footnote" style={{ marginTop: 0, marginBottom: 12 }}>
            The 34 core stats used across the profile sheets, ladder, gap card and the rank models.
            "Math" is the precise technical definition (thresholds, denominators, aggregation).
          </p>
          {statCats.map(([cat, items]) => (
            <div key={cat}>
              <div className="sheet-h" style={{ marginTop: 18 }}>{cat}</div>
              <div className="info-grid">
                {items.map((d) => (
                  <div key={d.key} className="card info-card">
                    <div className="info-term">{d.label}</div>
                    <p className="info-body">{d.desc}</p>
                    {d.math && <p className="info-math">{d.math}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
