'use strict';
/** Minimal-but-complete player stats skeleton for rating invariant tests. */
function buildStats(over = {}) {
  const base = {
    timePlayed: 300,
    core: { score: 300, goals: 0, assists: 0, saves: 1, shots: 2 },
    boost: {
      avgAmount: 45, used: 900, collected: 900, bpm: 180, bigPads: 8, smallPads: 20,
      bigPadsStolen: 1, stolenAmount: 60, overfill: 50, pctZero: 8, pctFull: 10,
      buckets: [25, 25, 25, 25],
    },
    movement: {
      distance: 90000, avgSpeed: 1400, maxSpeed: 2200, pctSupersonic: 10,
      pctBoostSpeed: 45, pctSlow: 45, pctGround: 60, pctLowAir: 35, pctHighAir: 5,
      powerslides: 20, powerslideTime: 8,
    },
    positioning: {
      pctOffHalf: 45, pctDefHalf: 55, pctBehindBall: 60, pctAheadBall: 40,
      avgDistToBall: 2800, pctLastBack: 30, pctClosestToBall: 30, pctOffThird: 25,
      pctMidThird: 40, pctDefThird: 35, doubleCommits: 1, abandoned2v1: 0.5,
      concededWhileAhead: 0.5, pctLostForward: 5,
    },
    possession: {
      touches: 40, touchesPerMin: 8, aerialTouches: 5, possessionTime: 60,
      possessionPct: 33, dribbles: 4, passes: 6, turnovers: 8, steals: 8,
      fiftiesWon: 5, fiftiesLost: 5, kickoffsWon: 2, kickoffsLost: 2,
      kickoffsNeutral: 1, kickoffFirstTouch: 3, clears: 4, pressureClears: 2,
      concededAsLastMan: 0.5,
    },
    demos: { inflicted: 1, taken: 1 },
    xg: { total: 0.8, onTarget: 2, perShot: 0.4, finishing: 0, bigChances: 1, bigChancesScored: 0, zicers: 0, zicersScored: 0, shots: [] },
    estTier: 12,
  };
  // shallow-merge per section so overrides don't wipe siblings
  const out = JSON.parse(JSON.stringify(base));
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...out[k], ...v };
    else out[k] = v;
  }
  return out;
}

/** A lobby of n-vs-n players from per-player overrides. */
function lobby(spec) {
  return spec.map(([key, team, over], i) => ({ key, name: key, team, stats: buildStats(over || {}) }));
}

module.exports = { buildStats, lobby };
