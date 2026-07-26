'use strict';
/** Shared by the golden test and tools/update-golden.mjs: parse a fixture replay
 *  with rrrocket and reduce the analysis to a stable, reviewable summary. */
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { analyze } = require('../src/analyzer');

const RRROCKET = path.join(__dirname, '..', '..', 'tools', 'rrrocket.exe');
const FIXTURES = path.join(__dirname, 'fixtures');
const SNAPSHOT = path.join(__dirname, 'golden.snapshot.json');

function analyzeFixture(file) {
  if (!fs.existsSync(RRROCKET)) {
    throw new Error('rrrocket.exe missing — run: node tools/fetch-rrrocket.mjs');
  }
  const full = path.join(FIXTURES, file);
  const r = spawnSync(RRROCKET, ['--network-parse', '--json-lines', full], {
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`rrrocket failed for ${file}: ${(r.stderr || '').slice(0, 300)}`);
  return analyze(JSON.parse(r.stdout), file);
}

/** Reduce to the fields that must not drift silently. */
function summarize(a) {
  return {
    teamSize: a.teamSize,
    score: [a.team0Score, a.team1Score],
    overtime: a.overtime,
    duration: a.duration,
    goals: a.goals.map((g) => ({ team: g.team, t: g.timeActive ?? g.time })),
    teamXg: a.teamXg,
    players: a.players
      .map((p) => ({
        name: p.name, team: p.team,
        goals: p.core.goals, assists: p.core.assists, saves: p.core.saves,
        xg: p.xg.total, shots: p.xg.shots.length,
        touches: p.possession.touches,
        collected: Math.round(p.boost.collected),
        bigPads: p.boost.bigPads, smallPads: p.boost.smallPads,
        pctBehindBall: p.positioning.pctBehindBall,
        kickoffsWon: p.possession.kickoffsWon,
      }))
      .sort((x, y) => (x.name < y.name ? -1 : 1)),
  };
}

module.exports = { analyzeFixture, summarize, SNAPSHOT, FIXTURES };
