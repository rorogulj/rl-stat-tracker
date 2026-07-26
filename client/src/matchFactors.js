/**
 * "Why the match was won" — scores match factors and returns the decisive ones.
 * Each factor: { impact (0-100), team (0/1 it favors), title, detail }.
 * All from data /api/matches/:id already returns — no extra calls.
 */

const r1 = (x) => Math.round(x * 10) / 10;
const fd = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export function matchFactors(m) {
  const T = [m.players.filter((p) => p.team === 0), m.players.filter((p) => p.team === 1)];
  if (!T[0].length || !T[1].length) return [];
  const sum = (t, fn) => T[t].reduce((a, p) => a + (fn(p) || 0), 0);
  const goals = m.meta?.goals || [];
  const score = [m.team0_score, m.team1_score];
  if (score[0] === score[1]) return []; // draw — there is no "why X won"
  const winner = score[0] > score[1] ? 0 : 1;
  const tn = (t) => (t === 0 ? 'Blue' : 'Orange');
  const factors = [];
  const add = (impact, team, title, detail) => {
    if (impact > 6) factors.push({ impact: Math.min(100, Math.round(impact)), team, title, detail });
  };

  // --- finishing: goals vs xG (who was clinical, who wasteful) ---
  // meta.teamXg is the server's authoritative team xG (aggregated from shots — handles
  // own goals and unattributed chances); summing player totals is only the fallback
  const metaXg = m.meta?.teamXg;
  const xg = metaXg && metaXg[0] != null && metaXg[1] != null
    ? [metaXg[0], metaXg[1]]
    : [sum(0, (p) => p.xg?.total), sum(1, (p) => p.xg?.total)];
  const fin = [score[0] - xg[0], score[1] - xg[1]];
  const finDiff = fin[0] - fin[1];
  if (Math.abs(finDiff) > 0.6) {
    const t = finDiff > 0 ? 0 : 1;
    add(Math.abs(finDiff) * 26, t, 'Clinical finishing',
      `${tn(t)} scored ${score[t]} from ${r1(xg[t])} xG (${fin[t] >= 0 ? '+' : ''}${r1(fin[t])}) while ${tn(1 - t)} managed ${score[1 - t]} from ${r1(xg[1 - t])}.`);
  }

  // --- chance creation ---
  const xgDiff = xg[0] - xg[1];
  if (Math.abs(xgDiff) > 0.5) {
    const t = xgDiff > 0 ? 0 : 1;
    add(Math.abs(xgDiff) * 20, t, 'Created more chances',
      `${tn(t)} generated ${r1(xg[t])} xG vs ${r1(xg[1 - t])} — sustained attacking threat.`);
  }

  // --- goalkeeper of the match ---
  const topSaver = [...m.players].sort((a, b) => b.core.saves - a.core.saves)[0];
  if (topSaver && topSaver.core.saves >= 3) {
    add(topSaver.core.saves * 7, topSaver.team, 'Wall in goal',
      `${topSaver.name} made ${topSaver.core.saves} saves${score[topSaver.team] > score[1 - topSaver.team] ? ' to protect the win' : ' to keep it close'}.`);
  }

  // --- rotation discipline / defensive blunders ---
  const mistakes = (t) => sum(t, (p) => (p.possession.concededAsLastMan || 0) + (p.positioning.concededWhileAhead || 0))
    + 0.5 * sum(t, (p) => p.positioning.abandoned2v1 || 0)
    + 0.3 * sum(t, (p) => p.positioning.doubleCommits || 0);
  const mist = [mistakes(0), mistakes(1)];
  const mistDiff = mist[0] - mist[1];
  if (Math.abs(mistDiff) > 1.2) {
    const bad = mistDiff > 0 ? 0 : 1; // team with more mistakes
    const lastman = sum(bad, (p) => p.possession.concededAsLastMan || 0);
    const upfield = sum(bad, (p) => p.positioning.concededWhileAhead || 0);
    const dc = sum(bad, (p) => p.positioning.doubleCommits || 0);
    const bits = [];
    if (lastman) bits.push(`${lastman}× last man beaten`);
    if (upfield) bits.push(`${upfield}× caught upfield on conceded goals`);
    if (dc >= 2) bits.push(`${dc} double commits`);
    add(Math.abs(mistDiff) * 12, 1 - bad, 'Rotation discipline',
      `${tn(bad)} broke down defensively: ${bits.join(', ')}.`);
  }

  // --- kickoffs (+ goals right after a kickoff) --- (active clock, same one-clock
  // rule as the server: mixing stamped and unstamped goals gives negative gaps)
  const allActive = goals.every((g) => g.timeActive != null);
  let koGoals = [0, 0];
  let prevEnd = 0;
  for (const g of goals) {
    const gt = allActive ? g.timeActive : g.time;
    if (gt - prevEnd <= 10) koGoals[g.team === 1 ? 1 : 0]++;
    prevEnd = allActive ? gt : gt + 3;
  }
  if (koGoals[0] + koGoals[1] > 0 && koGoals[0] !== koGoals[1]) {
    const t = koGoals[0] > koGoals[1] ? 0 : 1;
    add(koGoals[t] * 18, t, 'Kickoff goals',
      `${tn(t)} scored ${koGoals[t]} goal${koGoals[t] > 1 ? 's' : ''} within 10 s of a kickoff — free momentum off the restart.`);
  } else {
    const koW = [sum(0, (p) => p.possession.kickoffsWon || 0), sum(1, (p) => p.possession.kickoffsWon || 0)];
    const koDiff = koW[0] - koW[1];
    if (Math.abs(koDiff) >= 3) {
      const t = koDiff > 0 ? 0 : 1;
      add(Math.abs(koDiff) * 5, t, 'Kickoff control',
        `${tn(t)} won ${koW[t]} kickoffs vs ${koW[1 - t]} — first touch dictated the tempo.`);
    }
  }

  // --- ball possession / territory ---
  const poss = m.meta?.teamPossession;
  if (poss && Math.abs(poss.pct0 - poss.pct1) > 10) {
    const t = poss.pct0 > poss.pct1 ? 0 : 1;
    add(Math.abs(poss.pct0 - poss.pct1) * 1.4, t, 'Territorial control',
      `${tn(t)} held ${t === 0 ? poss.pct0 : poss.pct1}% possession and dictated where the game was played.`);
  }

  // --- ball security: turnovers vs steals ---
  const to = [sum(0, (p) => p.possession.turnovers), sum(1, (p) => p.possession.turnovers)];
  const st = [sum(0, (p) => p.possession.steals), sum(1, (p) => p.possession.steals)];
  const ballSec = (st[0] - to[0]) - (st[1] - to[1]);
  if (Math.abs(ballSec) >= 6) {
    const t = ballSec > 0 ? 0 : 1;
    add(Math.abs(ballSec) * 2.2, t, 'Ball security',
      `${tn(1 - t)} gave the ball away ${to[1 - t]}× (won back ${st[1 - t]}) — ${tn(t)} punished the sloppiness.`);
  }

  // --- 50/50 duels ---
  const fw = [sum(0, (p) => p.possession.fiftiesWon || 0), sum(1, (p) => p.possession.fiftiesWon || 0)];
  const fl = [sum(0, (p) => p.possession.fiftiesLost || 0), sum(1, (p) => p.possession.fiftiesLost || 0)];
  const fPct = [fw[0] + fl[0] > 0 ? (fw[0] / (fw[0] + fl[0])) * 100 : 50, fw[1] + fl[1] > 0 ? (fw[1] / (fw[1] + fl[1])) * 100 : 50];
  if (Math.abs(fPct[0] - fPct[1]) > 16 && fw[0] + fl[0] >= 6) {
    const t = fPct[0] > fPct[1] ? 0 : 1;
    add(Math.abs(fPct[0] - fPct[1]) * 0.8, t, 'Won the 50/50s',
      `${tn(t)} took ${Math.round(fPct[t])}% of challenges — first to the ball all game.`);
  }

  // --- demolitions ---
  const dem = [sum(0, (p) => p.core.demosInflicted), sum(1, (p) => p.core.demosInflicted)];
  if (Math.abs(dem[0] - dem[1]) >= 3) {
    const t = dem[0] > dem[1] ? 0 : 1;
    const topDemo = [...T[t]].sort((a, b) => b.core.demosInflicted - a.core.demosInflicted)[0];
    add(Math.abs(dem[0] - dem[1]) * 7, t, 'Demo pressure',
      `${dem[t]} demolitions vs ${dem[1 - t]} (${topDemo.name} ×${topDemo.core.demosInflicted}) — constant chaos in ${tn(1 - t)}'s defense.`);
  }

  // --- boost control ---
  const stolen = [sum(0, (p) => p.boost.stolenAmount || 0), sum(1, (p) => p.boost.stolenAmount || 0)];
  const zero = [sum(0, (p) => p.boost.pctZero) / T[0].length, sum(1, (p) => p.boost.pctZero) / T[1].length];
  if (Math.abs(stolen[0] - stolen[1]) > 250 && Math.abs(zero[0] - zero[1]) > 4) {
    const t = stolen[0] > stolen[1] ? 0 : 1;
    add(14 + Math.abs(zero[0] - zero[1]), t, 'Boost starvation',
      `${tn(t)} stole ${Math.round(stolen[t])} boost; ${tn(1 - t)} sat at 0 boost ${r1(zero[1 - t])}% of the game.`);
  }

  // --- overtime / clutch / comeback ---
  if (m.overtime && goals.length) {
    const last = goals[goals.length - 1];
    add(30, winner, 'Won in overtime', `${last.player} scored the decider at ${fd(last.timeActive ?? last.time)}.`);
  }
  {
    const sc = [0, 0];
    let deficit = 0;
    for (const g of goals) {
      sc[g.team === 1 ? 1 : 0]++;
      const d = sc[1 - winner] - sc[winner];
      if (d > deficit) deficit = d;
    }
    if (deficit >= 2) add(16 + deficit * 8, winner, `Comeback from −${deficit}`,
      `${tn(winner)} trailed by ${deficit} and still took the game — mentality win.`);
  }
  // goal in the last minute of regulation that decided it
  if (!m.overtime && goals.length && Math.abs(score[0] - score[1]) === 1) {
    const last = goals[goals.length - 1];
    const lastT = last.timeActive ?? last.time; // active clock — raw time includes countdowns
    if (lastT > 240 && (last.team === 1 ? 1 : 0) === winner) {
      add(24, winner, 'Late winner', `${last.player} broke the deadlock at ${fd(lastT)} — no time to answer.`);
    }
  }

  return factors.sort((a, b) => b.impact - a.impact).slice(0, 5);
}
