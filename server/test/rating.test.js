'use strict';
// Rating invariants — the specification distilled from the audit verifications.
// Runs against an EMPTY database (fresh temp RL_DATA_DIR) so the absolute layer
// is inert and the anchors are exact on every machine, including CI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.RL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-rating-test-'));

const test = require('node:test');
const assert = require('node:assert');
const { matchRatings } = require('../src/rating');
const { lobby } = require('./helpers');

const ctx = (s0, s1, teamSize) => ({ score0: s0, score1: s1, teamSize });

test('identical 3v3 lobby with a tied score rates everyone exactly 50', () => {
  const players = lobby([
    ['a', 0], ['b', 0], ['c', 0],
    ['d', 1], ['e', 1], ['f', 1],
  ]);
  const r = matchRatings(players, ctx(2, 2, 3));
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) assert.equal(r[k].overall, 50, k);
});

test('identical 2v2 lobby at 0-0 penalizes nobody and stays symmetric', () => {
  const players = lobby([['a', 0], ['b', 0], ['c', 1], ['d', 1]]);
  const r = matchRatings(players, ctx(0, 0, 2));
  const vals = ['a', 'b', 'c', 'd'].map((k) => r[k].overall);
  assert.ok(vals.every((v) => v === vals[0]), 'all equal');
  assert.ok(vals[0] >= 50, 'no 0-0 penalty (clean-sheet floor may lift it)');
});

test('total 1v1 domination clears the old ~76 component cap by a wide margin', () => {
  const players = lobby([
    ['win', 0, {
      core: { goals: 7, score: 900, saves: 3, shots: 10 },
      xg: { total: 5.0, finishing: 2.0 },
      possession: { touches: 80, touchesPerMin: 16, possessionPct: 60, steals: 16, turnovers: 3, fiftiesWon: 9, fiftiesLost: 1, kickoffsWon: 6, kickoffsLost: 1, clears: 8 },
      positioning: { pctBehindBall: 70, pctOffHalf: 60 },
      boost: { avgAmount: 60, bigPadsStolen: 5, pctZero: 3 },
      movement: { pctSupersonic: 20, avgSpeed: 1600 },
      demos: { inflicted: 3, taken: 0 },
    }],
    ['lose', 1, {
      core: { goals: 0, score: 120, saves: 1, shots: 2 },
      xg: { total: 0.4, finishing: -0.4 },
      possession: { touches: 25, touchesPerMin: 5, possessionPct: 40, steals: 3, turnovers: 12, fiftiesWon: 1, fiftiesLost: 9, kickoffsWon: 1, kickoffsLost: 6, clears: 1 },
      positioning: { pctBehindBall: 45 },
      boost: { avgAmount: 25, pctZero: 20 },
    }],
  ]);
  const r = matchRatings(players, ctx(7, 0, 1));
  assert.ok(r.win.overall >= 80, `winner ${r.win.overall} should be >= 80`);
  assert.ok(r.lose.overall < 30, `loser ${r.lose.overall} should be < 30`);
});

test('1v1 win by the opponent own goal still rates the winner above the loser', () => {
  // score 1-0 for team 0, but NOBODY on team 0 has a credited goal
  const players = lobby([['win', 0], ['lose', 1]]);
  const r = matchRatings(players, ctx(1, 0, 1));
  assert.ok(r.win.overall > r.lose.overall, `${r.win.overall} > ${r.lose.overall}`);
});

test('3v3: the scorer outrates an otherwise identical passenger teammate', () => {
  const players = lobby([
    ['scorer', 0, { core: { goals: 3, score: 600 } }],
    ['passenger', 0],
    ['third', 0],
    ['d', 1], ['e', 1], ['f', 1],
  ]);
  const r = matchRatings(players, ctx(3, 0, 3));
  assert.ok(r.scorer.overall > r.passenger.overall);
  assert.ok(r.passenger.overall >= r.d.overall, 'winning passenger not below losers');
});

test('draws leave the impact layer neutral: mirrored 2-2 lobby stays symmetric across teams', () => {
  const over = { core: { goals: 1, score: 350 } };
  const players = lobby([
    ['a', 0, over], ['b', 0, over],
    ['c', 1, over], ['d', 1, over],
  ]);
  const r = matchRatings(players, ctx(2, 2, 2));
  assert.equal(r.a.overall, r.c.overall);
  assert.equal(r.b.overall, r.d.overall);
});
