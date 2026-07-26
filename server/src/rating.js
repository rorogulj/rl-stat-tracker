'use strict';
/**
 * Component game rating (1-99), v2 — three layers:
 *   overall = 0.55 · lobby (z-score within the match)
 *           + 0.30 · absolute production (z against all players in the database for that mode)
 *           + 0.15 · match impact (share of the team's goals, result/margin, clutch)
 * v2 fixes: a clean sheet gives a floor to the defense component; in incomplete lobbies (leaver)
 * the shorthanded team's possession/touches are scaled so a solo player doesn't look dominant.
 * Everything from the saved stats JSONs — no re-importing of replays.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Metric definitions per component. w = weight; the goalside weight grows with lobby rank. */
function componentDefs(lobbyTier) {
  const goalsideW = 0.9 + clamp((lobbyTier ?? 9) / 22, 0, 1) * 1.2;
  return {
    attack: [
      { get: (s) => s.core.goals, w: 3.0 },
      { get: (s) => s.core.assists, w: 1.6 },
      { get: (s) => (s.xg ? s.xg.total : 0), w: 2.0 },
      { get: (s) => (s.xg ? s.xg.finishing : 0), w: 1.4 },
      { get: (s) => s.core.shots, w: 1.0 },
    ],
    defense: [
      { get: (s) => s.core.saves, w: 1.5 },
      { get: (s) => s.possession.clears || 0, w: 1.1 },
      { get: (s) => s.possession.pressureClears || 0, w: 1.1 },
      { get: (s) => s.positioning.pctBehindBall, w: goalsideW },
      { get: (s) => -(s.possession.concededAsLastMan || 0), w: 1.7 },
      { get: (s) => -(s.positioning.concededWhileAhead || 0), w: 1.0 },
    ],
    possession: [
      { get: (s, adj) => s.possession.possessionPct * (adj || 1), w: 1.6 },
      { get: (s, adj) => s.possession.touchesPerMin * (adj || 1), w: 1.0 },
      { get: (s) => -s.possession.turnovers, w: 1.5 },
      { get: (s) => s.possession.steals, w: 1.2 },
      { get: (s) => s.possession.fiftyWinPct ?? 50, w: 1.0 },
      { get: (s) => s.possession.passes || 0, w: 0.8 },
    ],
    boost: [
      { get: (s) => s.boost.avgAmount, w: 1.2 },
      { get: (s) => s.boost.stolenAmount || 0, w: 1.0 },
      { get: (s) => -(s.boost.pctZero || 0), w: 1.3 },
      { get: (s) => -(s.boost.overfill || 0), w: 0.7 },
      { get: (s) => s.boost.bigPadsStolen || 0, w: 0.9 },
    ],
    pressure: [
      { get: (s) => s.core.demosInflicted, w: 2.0 },
      { get: (s) => -s.core.demosTaken, w: 1.0 },
      { get: (s) => s.possession.kickoffWinPct ?? 50, w: 1.2 },
      { get: (s) => s.possession.aerialTouches, w: 0.9 },
      { get: (s) => s.positioning.pctOffThird || 0, w: 0.7 },
    ],
  };
}

const OVERALL_W = { attack: 0.28, defense: 0.24, possession: 0.19, boost: 0.13, pressure: 0.16 };

// absolute layer: production against ALL players in the database for the same mode
const ABS_METRICS = [
  { get: (s) => s.core.goals, w: 3.0 },
  { get: (s) => s.core.assists, w: 1.5 },
  { get: (s) => s.core.saves, w: 1.5 },
  { get: (s) => (s.xg ? s.xg.total : 0), w: 1.6 },
  { get: (s) => s.core.score, w: 2.0 },
  { get: (s) => s.core.demosInflicted, w: 0.8 },
];

// cache of baseline stats per mode (mean/sd), refreshed every minute
const baseCache = new Map(); // teamSize -> { t, stats: [{mean, sd}] }
function baselines(teamSize) {
  const hit = baseCache.get(teamSize);
  if (hit && Date.now() - hit.t < 60 * 1000) return hit.stats;
  const { stmts } = require('./db');
  const vals = ABS_METRICS.map(() => []);
  for (const r of stmts.allPlayerRows.all()) {
    if (r.team_size !== teamSize) continue;
    let s;
    try { s = JSON.parse(r.stats); } catch { continue; }
    ABS_METRICS.forEach((m, i) => vals[i].push(m.get(s) || 0));
  }
  const stats = vals.map((arr) => {
    if (arr.length < 8) return null; // too little data for that mode
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
    return { mean, sd: Math.max(sd, Math.abs(mean) * 0.25 + 0.4) };
  });
  baseCache.set(teamSize, { t: Date.now(), stats });
  return stats;
}

/** Clutch goals from meta.goals: overtime or tied in the last minute. */
function clutchGoals(meta) {
  const out = new Map();
  const goals = (meta && meta.goals) || [];
  const score = [0, 0];
  for (const g of goals) {
    // active game clock when available (raw replay time includes countdowns and
    // celebrations, which shifted these windows ~10-30 s early / flagged fake OT)
    const gt = g.timeActive ?? g.time;
    const tiedBefore = score[0] === score[1];
    if ((tiedBefore && gt > 240) || gt > 300.5) out.set(g.player, (out.get(g.player) || 0) + 1);
    score[g.team === 1 ? 1 : 0]++;
  }
  return out;
}

/**
 * Ratings for all players of one match.
 * players: [{ key, name, team, stats }]
 * ctx: { meta?, score0?, score1?, teamSize? } — score for the impact layer and clean sheet.
 * Returns { [key]: { overall, attack, defense, possession, boost, pressure, clutch } }.
 */
function matchRatings(players, ctx = {}) {
  if (!players || !players.length) return {};
  // compatibility: the second argument used to be the meta object itself
  if (ctx && (ctx.goals || ctx.fieldTilt)) ctx = { meta: ctx };
  const meta = ctx.meta || null;

  const tiers = players.map((p) => p.stats.estTier).filter((v) => v != null);
  const lobbyTier = tiers.length ? tiers.reduce((a, b) => a + b, 0) / tiers.length : null;
  const defs = componentDefs(lobbyTier);
  const clutch = clutchGoals(meta);

  // score: from ctx or count goals from meta
  let score = [ctx.score0, ctx.score1];
  if (score[0] == null || score[1] == null) {
    score = [0, 0];
    for (const g of (meta && meta.goals) || []) score[g.team === 1 ? 1 : 0]++;
  }

  // incomplete lobby (leaver): scale the shorthanded team's possession/touches
  const nTeam = [players.filter((p) => p.team === 0).length, players.filter((p) => p.team === 1).length];
  const fullSize = Math.max(nTeam[0], nTeam[1], 1);
  const possAdj = (team) => (nTeam[team] && nTeam[team] < fullSize ? nTeam[team] / fullSize : 1);

  // z-functions per metric within the lobby
  const zFns = {};
  for (const [comp, metrics] of Object.entries(defs)) {
    zFns[comp] = metrics.map((m) => {
      const vals = players.map((p) => m.get(p.stats, possAdj(p.team)) || 0);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      const denom = Math.max(sd, Math.abs(mean) * 0.35 + 0.6);
      return (v) => clamp((v - mean) / denom, -2.4, 2.4);
    });
  }

  const teamSize = ctx.teamSize || fullSize;
  const base = baselines(teamSize);
  const teamGoals = [score[0] || 0, score[1] || 0];

  const out = {};
  for (const p of players) {
    // --- layer 1: lobby components ---
    const comps = {};
    for (const [comp, metrics] of Object.entries(defs)) {
      let acc = 0, wsum = 0;
      metrics.forEach((m, i) => {
        acc += zFns[comp][i](m.get(p.stats, possAdj(p.team)) || 0) * m.w;
        wsum += m.w;
      });
      // rescale by the lobby's maximum possible |z| (√(n−1) for population sd) so a
      // dominant 1v1 game can reach the same component range as a dominant 3v3 game;
      // 58 ≈ 26·√5 keeps 3v3 (6 players) exactly on the old scale
      comps[comp] = Math.round(clamp(50 + ((acc / wsum) / Math.sqrt(Math.max(1, players.length - 1))) * 58, 1, 99));
    }
    // clean sheet: the team conceded no goals → the defense did its job,
    // zero saves must not look like bad defense
    const oppGoals = teamGoals[1 - p.team];
    if (oppGoals === 0 && (score[0] != null)) comps.defense = Math.max(comps.defense, 58);

    let lobbyOverall = 0;
    for (const [comp, w] of Object.entries(OVERALL_W)) lobbyOverall += comps[comp] * w;

    // --- layer 2: absolute production (against the whole database for that mode) ---
    let absOverall = null;
    if (base && base.some(Boolean)) {
      let acc = 0, wsum = 0;
      ABS_METRICS.forEach((m, i) => {
        if (!base[i]) return;
        const z = clamp(((m.get(p.stats) || 0) - base[i].mean) / base[i].sd, -2.4, 2.4);
        acc += z * m.w; wsum += m.w;
      });
      if (wsum) absOverall = clamp(50 + (acc / wsum) * 26, 1, 99);
    }

    // --- layer 3: match impact (share of goals, result, clutch) ---
    // share is normalized by total credited events (goals + half-weighted assists) so
    // the team's shares sum to exactly 1 — a plain (g+a)/teamGoals double-counts
    // assisted goals and inflates assist-heavy teams; at 0-0 the share term is
    // neutral (a hard-fought defensive draw is not everyone underperforming)
    const g = p.stats.core.goals || 0, a = p.stats.core.assists || 0;
    // denominator from CREDITED goals (scoreboard stats), not the score — an
    // opponent's own goal raises the score without anyone on this team scoring,
    // which used to tank the whole team's share
    const creditedGoals = players.reduce((acc2, q) => acc2 + (q.team === p.team ? (q.stats.core.goals || 0) : 0), 0);
    const teamAssists = players.reduce((acc2, q) => acc2 + (q.team === p.team ? (q.stats.core.assists || 0) : 0), 0);
    const expShare = 1 / Math.max(1, nTeam[p.team]);
    const share = creditedGoals > 0 ? (g + 0.5 * a) / (creditedGoals + 0.5 * teamAssists) : expShare;
    const margin = Math.abs(teamGoals[0] - teamGoals[1]);
    const won = teamGoals[p.team] > teamGoals[1 - p.team];
    const lost = teamGoals[p.team] < teamGoals[1 - p.team];
    const nClutch = clutch.get(p.name) || 0;
    // in 1v1 "share of team goals" is always exactly the expectation (you ARE the
    // team), so the carry term was structurally zero and impact could never go
    // above ~71 — use goal difference as the carry signal instead
    const carry = nTeam[p.team] === 1
      ? Math.max(-35, Math.min(35, (teamGoals[p.team] - teamGoals[1 - p.team]) * 6))
      : (share - expShare) * 55;
    let impact = 50
      + carry
      + (won ? Math.min(12, 3 * margin) : lost ? -Math.min(12, 3 * margin) : 0)
      + Math.min(9, nClutch * 3);
    impact = clamp(impact, 1, 99);

    // --- combining the layers ---
    let overall = absOverall != null
      ? 0.55 * lobbyOverall + 0.30 * absOverall + 0.15 * impact
      : 0.80 * lobbyOverall + 0.20 * impact;

    out[p.key] = {
      overall: Math.round(clamp(overall, 1, 99)),
      ...comps,
      clutch: nClutch,
    };
  }
  return out;
}

module.exports = { matchRatings };
