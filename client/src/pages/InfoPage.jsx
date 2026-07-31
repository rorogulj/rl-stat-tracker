/**
 * Info — the app's encyclopedia. Written as a long-form article (Wikipedia-style
 * prose with numbered sections, a contents box and inline mathematics) rather
 * than a card list. RULE (CLAUDE.md): every new or changed number, statistic,
 * model or archetype MUST update its section here. The stats glossary at the
 * end renders straight from statDefs.js (desc + math), so new stats only need
 * those two fields filled in.
 */
import { useMemo, useState } from 'react';
import { STAT_DEFS } from '../statDefs.js';

/** Display formula block. */
const F = ({ children }) => <div className="wk-formula">{children}</div>;
/** Inline math / identifier. */
const M = ({ children }) => <code className="wk-m">{children}</code>;

// must mirror computeArchetype in server/src/aggregate.js
const ARCHETYPES = [
  ['Striker', 'Finishes plays: high goals and shots per game with strong conversion.', 'goals/game, shots/game, shooting %'],
  ['Playmaker', 'Creates more than they finish — assists rival goals, high possession and constant touches. 2v2/3v3 only.', 'assists÷goals ratio, possession %, touches/min'],
  ['Ballchaser', 'First to every ball, low time behind the ball, relentless pressure.', 'touches/min, LOW % behind ball, double commits (or supersonic in 1v1)'],
  ['Lawnmower', 'Owns the floor: supersonic on the ground, rarely airborne.', '% on ground, % supersonic, LOW aerial touches'],
  ['Aerial ace', 'Lives in the air — aerial touches, high-air time, flip resets.', 'aerial touches/game, % high air, flip resets'],
  ['The Wall', 'The last line: saves, clears, permanent goalside presence.', 'saves/game, % behind ball, clears/game'],
  ['Demo merchant', 'Plays the man as much as the ball — demos break the opponent\'s structure.', 'demos/game, % supersonic'],
  ['Boost scavenger', 'Starves opponents of resources: steals their big pads and the ball.', 'big pads stolen/game, steals/game'],
  ['Kickoff bully', 'Wins the first three seconds over and over.', 'kickoff win %, kickoff first-touch %'],
  ['All-rounder', 'No single dimension dominates — the fallback when no candidate scores ≥ 0.35.', '—'],
];

const SECTIONS = [
  {
    id: 'data', title: 'Data source and the active clock',
    body: (
      <>
        <p>
          Every number in the application is computed locally from Rocket League replay files.
          A replay stores the complete network stream of a match — positions, velocities and
          rotations of all cars and the ball at roughly 30 frames per second, together with
          boost, demolition and scoreboard events. The parser
          (<a href="https://github.com/nickbabcock/rrrocket" target="_blank" rel="noreferrer">rrrocket</a>,
          built on the boxcars library) converts this stream to JSON; a custom analysis engine
          then reconstructs the match event by event. Nothing is sampled or estimated from
          summary statistics — possession, positioning and every shot are derived from the
          raw frames.
        </p>
        <p>
          Two clocks appear throughout this article. The <i>raw clock</i> is the replay
          timestamp, which keeps running through kickoff countdowns and goal celebrations.
          The <i>active clock</i> counts only seconds in which the ball is live. All
          per-minute rates, goal times, overtime detection and clutch windows use the active
          clock; the raw clock survives only internally (linking shots to goals within the
          same stream). Overtime itself is read from the replay's
          own <M>bOverTime</M> attribute where present, with the active clock
          (&gt; 305 s) and header duration (&gt; 315 s) as fallbacks.
        </p>
      </>
    ),
  },
  {
    id: 'xg', title: 'Shot detection and expected goals (xG)',
    body: (
      <>
        <p>
          A <i>shot</i> is defined kinematically. After every touch the engine projects the
          ball's trajectory: the touch qualifies as a shot when the ball travels toward the
          opponent goal (velocity component ≥ 100 uu/s), is fast enough
          (≥ 500 uu/s, relaxed to ≥ 300 uu/s within 3 000 uu of goal so
          slow rollers and tap-ins count), and would arrive inside the goal mouth within the
          allowed flight time (4.5 s, or 6 s for close-range rollers). Airborne
          trajectories are projected ballistically with gravity
          (<M>z(t) = z₀ + v_z·t − ½·650·t²</M>); a rolling ball
          (<M>z &lt; 150, |v_z| &lt; 200</M>) is treated as a two-dimensional problem —
          applying gravity to a grounded ball would "predict" it falling through the floor,
          which is precisely the class of ground shots older versions silently discarded.
          The target test uses the real goal dimensions (half-width 893 uu, height
          642 uu) with a 90 uu tolerance.
        </p>
        <p>
          Each detected shot receives a <i>raw</i> probability from geometry: the opening
          angle of the goal as seen from the shot position (the classical two-post
          angle <M>θ = atan2(2w·|dy|, dy² + x² − w²)</M> with <M>w = 893</M>),
          shot speed and distance, combined in a logistic model:
        </p>
        <F>p_geo = σ( −2.9 + 4.5·(θ/π) + 1.4·(speed/4600) − 2.2·(dist/11000) )</F>
        <p>
          The defensive situation then adjusts this value. Opponents standing on the shot
          corridor (within 320 uu laterally, below 900 uu) act as blockers: one
          blocker multiplies the probability by 0.62, two or more by 0.45. With no blocker,
          the distance of the nearest defender to the goal matters: if it exceeds
          2 400 uu the net is effectively open and the value is floored by
          distance (0.92 within 2 500 uu, then 0.78 / 0.55 / 0.35); a defender
          merely out of position (1 200–2 400 uu) scales the value
          by 1.35.
        </p>
        <p>
          Three corrections operate on whole sequences rather than single touches.
          <b> Deduplication:</b> consecutive touches by the same player within 2.5 s of
          the sequence start are one chance, not several shots — the record of the best
          touch (highest raw value, with its own time and position) represents the sequence.
          <b> Rebounds:</b> a shot arriving within 1.6 s of a <i>different</i>
          teammate's shot faces a displaced goalkeeper and is multiplied by 1.3.
          <b> Calibration:</b> only after both steps is the raw value mapped onto an actual
          probability by Platt scaling,
        </p>
        <F>xG = σ( 0.49 · logit(p_geo) + 0.16 )</F>
        <p>
          with coefficients fitted by logistic regression on 1 385 deduplicated shots
          with known outcomes from the corrected pipeline; on the calibration sample the
          predicted total equals the actual goal total by construction. The raw value is
          stored alongside every shot so future refits need no reconstruction. Goals with no
          detected shot (deflections, own goals) synthesize a chance from the scorer's last
          touch geometry and pass through the same calibration; an own goal is never
          credited to the player who scored it — the chance belongs to the benefiting team.
          Team xG is the sum over the team's shots. Note that this is an
          <i> on-target</i> xG (xGOT semantics — "would it go in if not saved"), so average
          conversion is ~45–50%, higher than the broadcast-football xG scale.
        </p>
        <p>
          Derived statistics: <M>finishing = goals − xG</M> (positive = converting
          more than the chances were worth), <i>big chances</i> (xG ≥ 0.4)
          and <i>zicers</i> (xG ≥ 0.6) with their conversion rates.
        </p>
      </>
    ),
  },
  {
    id: 'rating', title: 'Game rating (1–99)',
    body: (
      <>
        <p>
          The number next to every player in every match is a weighted blend of three
          layers: <b>lobby performance</b> (55%), <b>absolute production</b> (30%)
          and <b>match impact</b> (15%). When no absolute baselines exist yet the blend
          degrades gracefully to 80/20 lobby/impact. Ratings are computed on the fly from
          stored statistics, so historical matches never need re-importing when the formula
          improves.
        </p>
        <p>
          <b>Lobby layer.</b> Twenty-seven metrics, grouped into five components
          (attack 0.28, defense 0.24, possession 0.19, boost 0.13, pressure 0.16 —
          weights summing to 1), are converted to z-scores against the other players of the
          same match: <M>z = (v − μ) / max(σ, 0.35·|μ| + 0.6)</M>, clamped
          to ±2.4, where μ and σ are the lobby mean and population standard deviation.
          Because the maximum attainable |z| in a lobby of <M>n</M> players
          is <M>√(n−1)</M>, the aggregated score is rescaled by lobby size so a
          dominant 1v1 game can reach the same range as a dominant 3v3 game:
        </p>
        <F>component = 50 + ( Σwᵢzᵢ / Σwᵢ ) / √(n−1) · 58&nbsp;&nbsp;&nbsp;(58 ≈ 26·√5 keeps the historical 3v3 scale)</F>
        <p>
          A clean sheet floors the defense component at 58 — zero saves behind a shutout is
          not evidence of bad defense. When a team is shorthanded (leaver), the remaining
          players' possession and touch counts are scaled before comparison.
        </p>
        <p>
          <b>Absolute layer.</b> The same idea against the whole local database for that
          mode: per-metric means and deviations over all recorded player-games (a metric
          participates once it has at least 8 samples), z-scores clamped at ±2.4,
          combined as <M>50 + z̄·26</M>. This is the layer that lets a strong lobby
          average above 50, as it should.
        </p>
        <p>
          <b>Impact layer.</b> Starts at 50 and adds three terms. The <i>carry</i> term
          measures the player's share of the team's credited goal involvements — an assist
          counts as half a goal and the shares of a team sum to exactly 1:
        </p>
        <F>share = (goals + 0.5·assists) / (team_goals + 0.5·team_assists),&nbsp;&nbsp;carry = (share − 1/n) · 55</F>
        <p>
          In 1v1 the share is identically 1 (the player <i>is</i> the team), so the carry
          term uses goal difference instead: <M>carry = clamp(6·(GF − GA), ±35)</M>.
          The denominator uses goals credited on the scoreboard, not the score — an
          opponent's own goal raises the score without anyone on the team scoring, and must
          not read as the whole team underperforming. A 0–0 result leaves the term neutral.
          The <i>result</i> term adds <M>±min(12, 3·margin)</M> for a win or loss,
          and each <i>clutch</i> goal (scored in overtime, or with the score tied inside
          the last minute of regulation, both on the active clock) adds 3, capped at 9.
        </p>
      </>
    ),
  },
  {
    id: 'rank', title: 'Rank estimation',
    body: (
      <>
        <p>
          Real ranks come from tracker.gg for every player in a match (per platform, with a
          persistent cache — the user's own rank refreshes hourly, others monthly).
          Everything else is estimated from performance, in two forms: a per-match estimate
          and a career model.
        </p>
        <p>
          <b>The career model</b> is a gradient-boosted decision tree ensemble (GBDT)
          written in dependency-free JavaScript, one model per mode, trained on a corpus of
          public ballchasing.com replays with known rank buckets. Training targets are the
          central tiers of the eight buckets (Bronze 2, Silver 5, Gold 8, Platinum 11,
          Diamond 14, Champion 17, Grand&nbsp;Champion 20, SSL 22); features are the 34
          per-game statistics of a single player-game. Hyper-parameters: up to 400 trees of
          depth 5, learning rate 0.06, 32-bin histogram splits, 85% row/column subsampling,
          early stopping after 30 stale rounds against a 15% validation split. The split is
          grouped by match (players of one match never straddle the split) and then purged
          of players who appear in the training half — with a fallback if the purge would
          leave fewer than 100 validation rows. Every model reports its validation MAE next
          to the MAE of a constant predictor (the "baseline"), because a model is only as
          good as its distance from that floor; both are visible on the Server page.
        </p>
        <p>
          Raw predictions inherit the corpus' label semantics (rank at recording time), so
          they are mapped onto today's tracker.gg scale by a linear correction fitted on
          players from the user's own matches whose real rank is cached: with at least 8
          such pairs a slope in [0.6, 1.6] is fitted (only if the predictions have
          real spread, variance ≥ 0.2² tiers — otherwise offset-only), with 3–7
          pairs an offset. The published estimate is the calibrated mean of per-game
          predictions over recent games.
        </p>
        <p>
          <b>The per-match estimate</b> ("Perf. estimate" in the match view) reads one
          game's statistics against per-bucket benchmark centroids, then shrinks toward the
          lobby prior — the average known rank of the lobby:
          <M> 0.45·estimate + 0.55·prior</M>, clamped to prior ± 2.5 tiers. One
          great game in a Champion lobby therefore cannot read as SSL; the unshrunk value
          feeds the smurf detector. The "gap to next rank" panel compares the user's recent
          averages against centroids linearly interpolated between bucket anchors, so the
          target is the next sub-rank, not the next whole bucket.
        </p>
        <p>
          Trained models ship with the app and are republished to the repository after
          significant retraining; every installation checks daily and adopts a newer
          published model automatically. A model trained locally (for users who build their
          own corpus) wins whenever it is newer; models whose feature list does not match
          the running code are rejected outright.
        </p>
      </>
    ),
  },
  {
    id: 'percentiles', title: 'Percentiles and benchmarks',
    body: (
      <>
        <p>
          A percentile answers "what fraction of the reference population do I beat", with
          ties given half credit (the midrank convention):
        </p>
        <F>pct = ( #below + ½·#equal ) / N · 100</F>
        <p>
          The preferred reference population is the benchmark corpus filtered to the user's
          own rank bucket and mode — used only when at least 200 player-games of exactly
          that bucket exist, because comparing a Champion against Bronzes would be worse
          than no comparison. Otherwise the fallback population is the players from the
          user's own matches (per-player averages, minimum two games, at least four
          players), with the profiled player excluded from their own pool. For inverted
          metrics ("less is better": turnovers, demos taken…) the percentile is mirrored.
        </p>
        <p>
          The Ladder page shows how every statistic scales across the eight buckets of the
          corpus, with sample sizes displayed; buckets below the minimum sample threshold
          are hidden rather than shown thin.
        </p>
        <p>
          Sample size matters on the user's side too: averages, percentiles and the
          playstyle read are noisy while the library is small, and single-game swings
          dominate until roughly ten matches of a mode are in. The profile shows a
          small-sample warning below that threshold rather than hiding anything — the
          numbers are real, they are just not yet stable.
        </p>
      </>
    ),
  },
  {
    id: 'archetypes', title: 'Playstyle archetypes',
    body: (
      <>
        <p>
          The archetype is a descriptive label, not a rating. Nine candidate archetypes are
          scored from the player's per-game averages; every candidate is a weighted mean of
          components normalized to [0, 1] by <M>n01(v, lo, hi) = clamp((v − lo)/(hi − lo))</M>,
          where the ranges [lo, hi] are calibrated per mode against benchmark corpus
          averages (weights of each candidate sum to 1). The highest-scoring candidate wins
          if it clears 0.35; otherwise the player is an <i>All-rounder</i>. A second
          candidate above the threshold appears as "with a hint of…". Playmaker is excluded
          in 1v1 — there is nobody to assist.
        </p>
        <div className="wk-table">
          {ARCHETYPES.map(([name, desc, signals]) => (
            <div key={name} className="wk-row">
              <span className="wk-cell-name">{name}</span>
              <span className="wk-cell-desc">{desc} {signals !== '—' && <span className="wk-signals">Signals: {signals}.</span>}</span>
            </div>
          ))}
        </div>
        <p>
          The six playstyle <i>axes</i> (attack, defense, control, speed, aerial, duels)
          shown under the archetype are benchmark percentiles of the underlying stats, and
          the <i>modifiers</i> (aerial, fast, technical, turnover-prone, strong in duels)
          are threshold flags on the same values.
        </p>
      </>
    ),
  },
  {
    id: 'coaching', title: 'Coaching analysis',
    body: (
      <>
        <p>
          The coaching panel scores a fixed set of candidate "leaks" over the last ten
          matches — 50/50 win rate, turnover balance, boost starvation, kickoffs, goals
          conceded as last man, double commits and abandoned 2v1s (team modes only), goals
          conceded while caught upfield, finishing versus xG, and time behind the ball.
          Each candidate converts its distance from a healthy threshold into a severity
          score; the highest severities become the "leaks" cards with a concrete piece of
          advice, topped up with the worst benchmark percentiles not already covered.
          Severity ordering is heuristic — the panel is a prioritized to-do list, not a
          measurement.
        </p>
      </>
    ),
  },
  {
    id: 'app', title: 'Technical notes',
    body: (
      <>
        <p>
          <b>Local by design.</b> The interface is only a front end; a small server on the
          user's machine watches the replay folder, analyzes new replays within seconds and
          keeps everything in a local SQLite database. The server binds
          to <M>127.0.0.1</M> and uploads nothing. The full list of outbound
          connections (all downloads) is documented in the repository README.
        </p>
        <p>
          <b>Player identity.</b> Players are keyed by the account id stored in the replay
          (Epic id, Steam id, or the PSN identity blob), so name changes do not split a
          player's history. Split-screen is the one exception: the guest ("name(1)")
          carries the <i>host's</i> account id in the replay, so the tracker derives a
          separate key for it from the "(N)" name suffix — the guest shows up as its own
          player and the host's profile stays clean.
        </p>
        <p>
          <b>Replay folder.</b> The watched folder is auto-detected (Rocket League saves
          replays under Documents, including OneDrive-redirected setups) and can be changed
          in Settings → Replay folder — the choice is validated, stored in the local
          configuration and takes effect immediately, importing whatever the new folder
          contains. The <M>RL_REPLAY_DIR</M> environment variable still works as an
          override for scripted setups.
        </p>
        <p>
          <b>Welcome screen.</b> If <M>/api/status</M> does not answer — the public
          demo deployment, or the server simply not running — a landing screen appears with
          setup instructions, re-checking every five seconds and loading the app the moment
          the server comes up. The public page does not probe for a local tracker —
          browsers block or permission-gate requests from a public page
          to <M>localhost</M>, which made any automatic check unreliable — it simply
          links to <M>localhost:7845</M>, where a plain navigation always reaches an
          installed tracker. The link is desktop-only, and this article is served
          standalone at <M>/info</M> so it stays readable on phones.
        </p>
        <p>
          <b>Updates.</b> The server compares its version against the repository every six
          hours. When a newer release exists, an ↑ button appears in the top bar; one click
          re-runs the installer, which downloads the <i>tagged release snapshot</i> (never
          the moving tip of the repository), rebuilds and restarts — the page reloads
          itself. Nothing ever installs without that click, the current state is always
          visible on the server status page (<M>localhost:7845/server</M>), and the
          check can be disabled with <M>RL_NO_UPDATE_CHECK=1</M>. The database lives
          outside the application folder and survives every update.
        </p>
        <p>
          <b>Reproducibility.</b> The analysis engine is versioned; changing it triggers a
          one-time re-analysis of the whole library. A regression suite (rating invariants
          plus golden-replay snapshots of four real matches) runs in CI on every change, so
          a formula can only change together with a reviewed diff of its effects.
        </p>
      </>
    ),
  },
];

export default function InfoPage() {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const hit = (...texts) => !needle || texts.some((t) => (t || '').toLowerCase().includes(needle));
  const stats = useMemo(() => STAT_DEFS.filter((d) => hit(d.label, d.desc, d.math, d.cat, d.key)), [needle]);
  const statCats = useMemo(() => {
    const g = new Map();
    for (const d of stats) {
      const cat = d.cat || 'Other';
      if (!g.has(cat)) g.set(cat, []);
      g.get(cat).push(d);
    }
    return [...g.entries()];
  }, [stats]);

  return (
    <div className="wiki">
      <h1 className="wk-title">How everything is computed</h1>
      <p className="wk-lead">
        This page documents the mathematics and definitions behind every number in
        RL Stat Tracker: how shots and expected goals are detected and calibrated, how the
        1–99 rating is assembled, how ranks are estimated and how the reference benchmarks
        work. It is maintained together with the code — when a formula changes, this text
        changes in the same release.
      </p>

      <div className="wk-toc card">
        <div className="wk-toc-h">Contents</div>
        <ol>
          {SECTIONS.map((s, i) => (
            <li key={s.id}><a href={`#${s.id}`}>{i + 1}. {s.title}</a></li>
          ))}
          <li><a href="#glossary">{SECTIONS.length + 1}. Glossary of statistics</a></li>
        </ol>
      </div>

      {SECTIONS.map((s, i) => (
        <section key={s.id} id={s.id} className="wk-section">
          <h2 className="wk-h2"><span className="wk-num">{i + 1}.</span> {s.title}</h2>
          {s.body}
        </section>
      ))}

      <section id="glossary" className="wk-section">
        <h2 className="wk-h2"><span className="wk-num">{SECTIONS.length + 1}.</span> Glossary of statistics</h2>
        <p>
          Every tracked statistic with its definition and, where useful, the exact rule the
          engine applies. The glossary is generated from the same definitions the interface
          uses, so it cannot drift from the app.
        </p>
        <input
          className="search-input wk-search"
          placeholder="Filter statistics… (e.g. xG, boost, kickoff)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {statCats.map(([cat, defs]) => (
          <div key={cat} className="wk-gloss-cat">
            <h3 className="wk-h3">{cat}</h3>
            {defs.map((d) => (
              <p key={d.key} className="wk-gloss-entry">
                <b>{d.label}.</b> {d.desc}{d.desc?.endsWith('.') ? '' : '.'}
                {d.math && <span className="wk-signals"> {d.math}.</span>}
              </p>
            ))}
          </div>
        ))}
        {!stats.length && <p className="wk-gloss-entry">No statistic matches "{q}".</p>}
      </section>
    </div>
  );
}
