'use strict';
const { stmts } = require('./db');
const { matchRatings } = require('./rating');

/**
 * Component ratings for a set of matches: mid → { playerKey → rating }.
 * Lobby-normalized, so it is fair regardless of opponent rank.
 */
function ratingsForMids(midSet) {
  const lobbies = new Map();
  for (const r of stmts.allPlayerRows.all()) {
    if (!midSet.has(r.mid)) continue;
    const e = lobbies.get(r.mid) || { players: [], score0: r.team0_score, score1: r.team1_score, teamSize: r.team_size };
    if (!e.players.some((p) => p.key === r.player_key)) {
      e.players.push({ key: r.player_key, name: r.name, team: r.team, stats: JSON.parse(r.stats) });
    }
    lobbies.set(r.mid, e);
  }
  const out = new Map();
  for (const [mid, e] of lobbies) {
    let meta = null;
    const mrow = stmts.getMatch.get(mid);
    if (mrow) { try { meta = JSON.parse(mrow.meta || '{}'); } catch { /* no clutch data */ } }
    out.set(mid, matchRatings(e.players, { meta, score0: e.score0, score1: e.score1, teamSize: e.teamSize }));
  }
  return out;
}

/** All my accounts (settings.my_accounts JSON list) or automatically the most frequent player. */
function myKeys() {
  const rows = stmts.playerCounts.all();
  const setting = stmts.getSetting.get('my_accounts');
  if (setting && setting.value) {
    try {
      const arr = JSON.parse(setting.value).filter((k) => rows.some((r) => r.player_key === k));
      if (arr.length) return arr;
    } catch { /* corrupted JSON → fallback */ }
  }
  const humans = rows.filter((r) => !r.bot_matches || r.bot_matches < r.matches);
  const auto = humans.length ? humans[0].player_key : (rows[0] ? rows[0].player_key : null);
  return auto ? [auto] : [];
}

/** Primary account (most matches among mine) — for rank, calibration, MMR history. */
function detectMe() {
  const keys = myKeys();
  if (!keys.length) return null;
  const counts = stmts.playerCounts.all();
  return keys.slice().sort((a, b) =>
    (counts.find((r) => r.player_key === b)?.matches || 0) - (counts.find((r) => r.player_key === a)?.matches || 0)
  )[0];
}

/** Name of the currently tracked account (for tracker.gg fetching and cache). */
function meName() {
  const me = detectMe();
  const row = me && stmts.playerCounts.all().find((r) => r.player_key === me);
  return row ? row.name : null;
}

function winForRow(r) {
  const myTeamScore = r.team === 0 ? r.team0_score : r.team1_score;
  const oppScore = r.team === 0 ? r.team1_score : r.team0_score;
  return myTeamScore > oppScore ? 1 : myTeamScore < oppScore ? -1 : 0;
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function r1(x) { return Math.round(x * 10) / 10; }

/**
 * Career profile + trend series. playerKeyOrKeys: a single key (profile of any player)
 * or a list of keys (my accounts → combined stats). mode = team_size filter.
 */
function profile(playerKeyOrKeys, mode) {
  const keys = Array.isArray(playerKeyOrKeys) ? playerKeyOrKeys : [playerKeyOrKeys];
  const rows = stmts.allPlayerRows.all()
    .filter((r) => keys.includes(r.player_key))
    .filter((r) => !mode || r.team_size === Number(mode));
  if (!rows.length) return null;

  const games = rows.map((r) => {
    const s = JSON.parse(r.stats);
    return { r, s, win: winForRow(r) };
  }).sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : 0));

  // component ratings (lobby-normalized) + match meta for records/kickoffs
  const midSet = new Set(games.map((g) => g.r.mid));
  const ratingByMid = ratingsForMids(midSet);
  const myRating = (g) => ratingByMid.get(g.r.mid)?.[g.r.player_key] || null;
  const myRatings = games.map(myRating).filter(Boolean);
  const metaByMid = new Map();
  for (const mid of midSet) {
    const m = stmts.getMatch.get(mid);
    if (m) { try { metaByMid.set(mid, JSON.parse(m.meta || '{}')); } catch { /* skip */ } }
  }

  const wins = games.filter((g) => g.win > 0).length;
  const losses = games.filter((g) => g.win < 0).length;
  const c = (fn) => games.map((g) => fn(g.s) || 0);

  const totalGoals = sum(c((s) => s.core.goals));
  const totalShots = sum(c((s) => s.core.shots));

  // rank: real (from ranked replays if available) + estimated from performance
  // estimates calibrated with MY real rank as the anchor (same mode = same lobbies),
  // so it also holds for friend/opponent profiles
  const me = detectMe();
  const isMe = keys.includes(me);
  const primaryKey = isMe ? me : keys[0];
  const calF = calibrationFactor(me, mode);
  const realTiers = games.map((g) => g.s.tier).filter(Boolean);
  const estTiers = games.map((g) => calTier(g.s.estTier, calF)).filter((v) => v != null);
  const recentEst = estTiers.slice(-8);

  // opponent average (for the "me vs opponents" comparison)
  const oppRows = stmts.allPlayerRows.all()
    .filter((r) => !mode || r.team_size === Number(mode))
    .filter((r) => !keys.includes(r.player_key) && games.some((g) => g.r.mid === r.mid))
    .filter((r) => { const g = games.find((g2) => g2.r.mid === r.mid); return g && r.team !== g.r.team; });
  const oppStats = oppRows.map((r) => JSON.parse(r.stats));
  const o = (fn) => oppStats.length ? avg(oppStats.map((s) => fn(s) || 0)) : 0;

  // career heatmap: normalize EVERY match (including the first) into the team-0
  // frame at accumulation time — a trailing whole-grid flip keyed on game 0's team
  // used to rotate all the other, already-normalized games 180° out of frame
  const h0 = games[0].s.heatmap;
  const HR = h0.length, HC = h0[0].length;
  const flip0 = games[0].r.team === 1;
  const heat = h0.map((row, y) => row.map((_, x) => (flip0 ? h0[HR - 1 - y][HC - 1 - x] : h0[y][x])));
  for (let i = 1; i < games.length; i++) {
    const h = games[i].s.heatmap;
    const flip = games[i].r.team === 1;
    for (let y = 0; y < HR; y++) for (let x = 0; x < HC; x++) {
      heat[y][x] += flip ? h[HR - 1 - y][HC - 1 - x] : h[y][x];
    }
  }

  // list of accounts included in this profile (for the multi-account view)
  const accounts = keys.map((k) => {
    const mine = rows.filter((r) => r.player_key === k);
    return mine.length ? { key: k, name: mine[mine.length - 1].name, games: mine.length } : null;
  }).filter(Boolean);

  return {
    key: primaryKey,
    name: accounts.length > 1 ? accounts.map((a) => a.name).join(' + ') : games[games.length - 1].r.name,
    accounts,
    games: games.length,
    wins, losses, draws: games.length - wins - losses,
    winPct: r1((wins / games.length) * 100),
    mvps: games.filter((g) => g.r.mvp).length,
    overtimeGames: games.filter((g) => g.r.overtime).length,
    isMe,
    rank: (() => {
      // the learned model (GBDT → centroid fallback) takes precedence over the heuristic
      const benchRecent = learnedTierEstimate(games.slice(-8), mode);
      const benchAvg = benchRecent != null ? learnedTierEstimate(games, mode) : null;
      // estimate of the CURRENT session (= last calendar day of play, same definition as on Matches)
      const lastDay = (games[games.length - 1].r.date || '').slice(0, 10);
      const sessionGames = games.filter((g) => (g.r.date || '').slice(0, 10) === lastDay);
      const sessionEst = learnedTierEstimate(sessionGames, mode)
        ?? (sessionGames.length ? r1(avg(sessionGames.map((g) => calTier(g.s.estTier, calF)).filter((v) => v != null))) || null : null);
      let gbdtActive = false;
      try { gbdtActive = require('./gbdt').estimateTier(games.slice(-1), mode) != null; } catch { /* not available */ }
      return {
        sessionTier: sessionEst,
        sessionGames: sessionGames.length,
        sessionDay: lastDay,
        gbdt: gbdtActive,
        replayTier: realTiers.length ? realTiers[realTiers.length - 1] : null, // last known from a ranked replay
        // real rank from tracker.gg: for me from the main cache, for others from the player_ranks cache
        trn: isMe ? require('./trn').cachedRankForMode(mode) : (mode ? require('./trn').cachedPlayerRank(primaryKey, mode) : null),
        manualTier: isMe ? getManualTier(mode) : null,
        estTierAvg: benchAvg ?? (estTiers.length ? r1(avg(estTiers)) : null),
        estTierRecent: benchRecent ?? (recentEst.length ? r1(avg(recentEst)) : null),
        estSource: gbdtActive ? 'gbdt' : benchRecent != null ? 'benchmark' : 'heuristic',
        calibrated: calF !== 1,
      };
    })(),
    // statistical "gap to the next rank bucket": my averages vs the next bucket's
    // centroid from the benchmark — which stats lag the most (z-sorted)
    nextRankGap: (() => {
      if (!mode) return null;
      const myTier = (() => {
        const t = isMe ? require('./trn').cachedRankForMode(mode) : require('./trn').cachedPlayerRank(primaryKey, mode);
        if (t && t.tier != null && t.tier > 0) return t.tier;
        return realTiers.length ? realTiers[realTiers.length - 1] : null;
      })();
      if (myTier == null) return null;
      // the target is the NEXT SUB-RANK (Champ 1 → Champ 2), not the next bucket:
      // centroids exist only per bucket (anchors at BUCKET_TIERS tiers),
      // so we linearly interpolate the centroid for an arbitrary tier between anchors
      const nextTier = Math.min(22, Math.round(myTier) + 1);
      if (Math.round(myTier) >= 22) return null; // already SSL
      const model = getBenchModel(mode);
      const cur = benchCentroidAtTier(model, myTier);
      const next = benchCentroidAtTier(model, nextTier);
      if (!cur || !next) return null;
      const myBucket = tierToBucket(myTier);
      const nextBucket = tierToBucket(nextTier);
      const recent = games.slice(-20);
      const rows = SHEET_STATS.map(([key, get, invert], i) => {
        const mine = avg(recent.map((g) => get(g.s) || 0));
        const deficit = invert ? mine - next.mean[i] : next.mean[i] - mine;
        const z = deficit / Math.max(next.sd[i], Math.abs(next.mean[i]) * 0.15 + 0.3);
        // the progress bar only makes sense when the stat monotonically "improves" toward
        // the next bucket (for invert: decreases); otherwise it is null and the UI shows only z
        const denom = next.mean[i] - cur.mean[i];
        const monotone = invert ? denom < -1e-9 : denom > 1e-9;
        const progress = monotone
          ? Math.round(Math.max(0, Math.min(1, (mine - cur.mean[i]) / denom)) * 100) / 100
          : null;
        return {
          key, invert: !!invert,
          mine: Math.round(mine * 100) / 100,
          cur: Math.round(cur.mean[i] * 100) / 100,
          next: Math.round(next.mean[i] * 100) / 100,
          z: Math.round(z * 100) / 100,
          progress,
        };
      }).filter((r) => r.z > 0.05)
        .sort((a, b) => b.z - a.z)
        .slice(0, 8);
      return rows.length ? {
        myBucket, nextBucket, curTier: Math.round(myTier), nextTier,
        basedOnGames: recent.length, benchN: next.n, rows,
      } : null;
    })(),
    xg: {
      totalXg: r1(sum(c((s) => s.xg ? s.xg.total : 0))),
      xgPerGame: r1(avg(c((s) => s.xg ? s.xg.total : 0))),
      finishingTotal: r1(sum(c((s) => s.xg ? s.xg.finishing : 0))),
      finishingPerGame: r1(avg(c((s) => s.xg ? s.xg.finishing : 0))),
      xgPerShot: r1(avg(c((s) => s.xg ? s.xg.perShot : 0)) * 100) / 100,
      bigChances: sum(c((s) => s.xg ? s.xg.bigChances || 0 : 0)),
      bigChancesScored: sum(c((s) => s.xg ? s.xg.bigChancesScored || 0 : 0)),
      bigChanceConvPct: (() => {
        const bc = sum(c((s) => s.xg ? s.xg.bigChances || 0 : 0));
        return bc > 0 ? r1((sum(c((s) => s.xg ? s.xg.bigChancesScored || 0 : 0)) / bc) * 100) : null;
      })(),
    },
    opponentAvg: oppStats.length ? {
      games: oppStats.length,
      score: r1(o((s) => s.core.score)),
      goals: r1(o((s) => s.core.goals)),
      assists: r1(o((s) => s.core.assists)),
      saves: r1(o((s) => s.core.saves)),
      shots: r1(o((s) => s.core.shots)),
      shootingPct: r1(o((s) => s.core.shootingPct)),
      xgPerGame: r1(o((s) => s.xg ? s.xg.total : 0)),
      avgBoost: r1(o((s) => s.boost.avgAmount)),
      boostPerMin: r1(o((s) => s.boost.usedPerMin)),
      avgSpeed: Math.round(o((s) => s.movement.avgSpeed)),
      pctSupersonic: r1(o((s) => s.movement.pctSupersonic)),
      possessionPct: r1(o((s) => s.possession.possessionPct)),
      touchesPerMin: r1(o((s) => s.possession.touchesPerMin)),
      estTier: calTier(o((s) => s.estTier || 0), calF),
    } : null,
    totals: {
      goals: totalGoals,
      assists: sum(c((s) => s.core.assists)),
      saves: sum(c((s) => s.core.saves)),
      shots: totalShots,
      score: sum(c((s) => s.core.score)),
      demosInflicted: sum(c((s) => s.core.demosInflicted)),
      demosTaken: sum(c((s) => s.core.demosTaken)),
      distanceKm: r1(sum(c((s) => s.movement.distanceM)) / 1000),
      timePlayedMin: r1(sum(c((s) => s.timePlayed)) / 60),
      touches: sum(c((s) => s.possession.touches)),
      boostUsed: sum(c((s) => s.boost.used)),
    },
    perGame: {
      score: r1(avg(c((s) => s.core.score))),
      goals: r1(avg(c((s) => s.core.goals))),
      assists: r1(avg(c((s) => s.core.assists))),
      saves: r1(avg(c((s) => s.core.saves))),
      shots: r1(avg(c((s) => s.core.shots))),
      shootingPct: totalShots > 0 ? r1((totalGoals / totalShots) * 100) : 0,
      demos: r1(avg(c((s) => s.core.demosInflicted))),
      touches: r1(avg(c((s) => s.possession.touches))),
    },
    averages: {
      avgBoost: r1(avg(c((s) => s.boost.avgAmount))),
      boostPerMin: r1(avg(c((s) => s.boost.usedPerMin))),
      pctZeroBoost: r1(avg(c((s) => s.boost.pctZero))),
      pctFullBoost: r1(avg(c((s) => s.boost.pctFull))),
      bigPads: r1(avg(c((s) => s.boost.bigPads))),
      smallPads: r1(avg(c((s) => s.boost.smallPads))),
      stolenBigPads: r1(avg(c((s) => s.boost.bigPadsStolen))),
      avgSpeed: Math.round(avg(c((s) => s.movement.avgSpeed))),
      powerslides: r1(avg(c((s) => s.movement.powerslides || 0))),
      powerslidesPerMin: r1(avg(c((s) => s.movement.powerslidesPerMin || 0))),
      powerslideTimeS: r1(avg(c((s) => s.movement.powerslideTimeS || 0))),
      flipResets: r1(avg(c((s) => s.movement.flipResets || 0))),
      pctSupersonic: r1(avg(c((s) => s.movement.pctSupersonic))),
      pctGround: r1(avg(c((s) => s.movement.pctGround))),
      pctLowAir: r1(avg(c((s) => s.movement.pctLowAir))),
      pctHighAir: r1(avg(c((s) => s.movement.pctHighAir))),
      pctDefHalf: r1(avg(c((s) => s.positioning.pctDefHalf))),
      pctOffHalf: r1(avg(c((s) => s.positioning.pctOffHalf))),
      pctBehindBall: r1(avg(c((s) => s.positioning.pctBehindBall))),
      avgDistToBallM: Math.round(avg(c((s) => s.positioning.avgDistToBallM))),
      possessionPct: r1(avg(c((s) => s.possession.possessionPct))),
      touchesPerMin: r1(avg(c((s) => s.possession.touchesPerMin))),
      aerialTouches: r1(avg(c((s) => s.possession.aerialTouches))),
      turnovers: r1(avg(c((s) => s.possession.turnovers))),
      steals: r1(avg(c((s) => s.possession.steals))),
      kickoffFirstTouchPct: r1(avg(c((s) => s.possession.kickoffFirstTouchPct))),
      clears: r1(avg(c((s) => s.possession.clears || 0))),
      fiftiesWon: r1(avg(c((s) => s.possession.fiftiesWon || 0))),
      fiftiesLost: r1(avg(c((s) => s.possession.fiftiesLost || 0))),
      fiftyWinPct: (() => {
        const w = sum(c((s) => s.possession.fiftiesWon || 0)), l = sum(c((s) => s.possession.fiftiesLost || 0));
        return w + l > 0 ? r1((w / (w + l)) * 100) : null;
      })(),
      kickoffWinPct: (() => {
        const w = sum(c((s) => s.possession.kickoffsWon || 0)), l = sum(c((s) => s.possession.kickoffsLost || 0));
        return w + l > 0 ? r1((w / (w + l)) * 100) : null;
      })(),
      concededAsLastMan: r1(avg(c((s) => s.possession.concededAsLastMan || 0))),
      pressureClears: r1(avg(c((s) => s.possession.pressureClears || 0))),
      abandoned2v1: r1(avg(c((s) => s.positioning.abandoned2v1 || 0))),
      concededWhileAhead: r1(avg(c((s) => s.positioning.concededWhileAhead || 0))),
      aheadStreakAvg: r1(avg(c((s) => s.positioning.aheadStreakAvg || 0))),
      pctLostForward: r1(avg(c((s) => s.positioning.pctLostForward || 0))),
      doubleCommits: r1(avg(c((s) => s.positioning.doubleCommits || 0))),
      touchSharePct: (() => {
        const vals = games.map((g) => g.s.possession.touchSharePct).filter((v) => v != null);
        return vals.length ? r1(avg(vals)) : null;
      })(),
      zicers: sum(c((s) => s.xg ? s.xg.zicers || 0 : 0)),
      zicersScored: sum(c((s) => s.xg ? s.xg.zicersScored || 0 : 0)),
    },
    style: (() => {
      const styles = games.map((g) => g.s.style).filter(Boolean);
      if (!styles.length) return null;
      const axes = {};
      for (const k of Object.keys(styles[0].axes)) axes[k] = Math.round(avg(styles.map((st) => st.axes[k])));
      const tagCounts = {};
      for (const st of styles) for (const tg of st.tags) tagCounts[tg] = (tagCounts[tg] || 0) + 1;
      const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([tag, count]) => ({ tag, count }));
      const { archetype, archetype2, archScores } = computeArchetype(games.map((g) => g.s), mode);
      const mods = [];
      if (axes.aerial >= 55) mods.push('aerial');
      if (axes.speed >= 62) mods.push('fast');
      if (axes.control >= 65) mods.push('technical');
      if (axes.control <= 35) mods.push('turnover-prone');
      if (axes.duels >= 62) mods.push('strong in duels');
      return { axes, tags, archetype, archetype2, modifiers: mods, archScores };
    })(),
    // average component rating (for the radar) + percentile of each component
    // against the average of ALL other players from my matches
    ratingAvg: myRatings.length ? (() => {
      const comps = ['overall', 'attack', 'defense', 'possession', 'boost', 'pressure'];
      const out = {};
      for (const k of comps) out[k] = r1(avg(myRatings.map((x) => x[k])));
      const perPlayer = new Map();
      for (const ratings of ratingByMid.values()) {
        for (const [key, rr] of Object.entries(ratings)) {
          if (keys.includes(key)) continue;
          const e = perPlayer.get(key) || { n: 0, sums: Object.fromEntries(comps.map((k) => [k, 0])) };
          e.n++;
          for (const k of comps) e.sums[k] += rr[k];
          perPlayer.set(key, e);
        }
      }
      const others = [...perPlayer.values()];
      out.pct = {};
      for (const k of comps) {
        if (!others.length) { out.pct[k] = null; continue; }
        const below = others.filter((e) => e.sums[k] / e.n < out[k]).length;
        out.pct[k] = Math.round((below / others.length) * 100);
      }
      return out;
    })() : null,
    records: (() => {
      const best = (fn, dir = 1) => {
        let bg = null, bv = null;
        for (const g of games) {
          const v = fn(g);
          if (v == null) continue;
          if (bv == null || (dir > 0 ? v > bv : v < bv)) { bv = v; bg = g; }
        }
        return bg ? { v: r1(bv), matchId: bg.r.mid, date: bg.r.date } : null;
      };
      // my fastest goal (from meta.goals by name in that match)
      const fastestGoal = best((g) => {
        const goals = (metaByMid.get(g.r.mid) || {}).goals || [];
        // team check: an own goal is header-credited to the own-goaler, and a name
        // match alone would make someone else's own goal my "fastest goal" record
        const mine = goals.filter((x) => x.player === g.r.name && x.team === g.r.team);
        // active clock — raw replay time includes the pre-kickoff countdown
        return mine.length ? Math.min(...mine.map((x) => x.timeActive ?? x.time)) : null;
      }, -1);
      // biggest comeback: max deficit recovered in a win
      const comeback = best((g) => {
        if (g.win <= 0) return null;
        const goals = (metaByMid.get(g.r.mid) || {}).goals || [];
        const sc = [0, 0];
        let deficit = 0;
        for (const x of goals) {
          sc[x.team === 1 ? 1 : 0]++;
          const d = (g.r.team === 0 ? sc[1] - sc[0] : sc[0] - sc[1]);
          if (d > deficit) deficit = d;
        }
        return deficit >= 2 ? deficit : null;
      });
      let streak = 0, bestStreak = 0;
      for (const g of games) {
        if (g.win > 0) { streak++; if (streak > bestStreak) bestStreak = streak; } else streak = 0;
      }
      return {
        fastestGoal,
        mostGoals: best((g) => g.s.core.goals || null),
        mostSaves: best((g) => g.s.core.saves || null),
        mostScore: best((g) => g.s.core.score || null),
        bestRating: best((g) => myRating(g)?.overall ?? null),
        longestWinStreak: bestStreak,
        biggestComeback: comeback,
        longestMatch: best((g) => (metaByMid.get(g.r.mid) || {}).totalSeconds || null),
      };
    })(),
    kickoffs: (() => {
      // goals within 10 s of a kickoff (kickoff = start or ~3 s after the previous goal)
      let forOff = 0, againstOff = 0, matchesWithGoals = 0;
      for (const g of games) {
        const goals = (metaByMid.get(g.r.mid) || {}).goals || [];
        if (goals.length) matchesWithGoals++;
        // on the active clock no time passes between a goal and the next kickoff,
        // so "≤10 s since the previous goal" = "≤10 s of play since the kickoff".
        // Mixing clocks WITHIN a match (some goals missing timeActive — same-frame
        // goals etc.) produces negative gaps, so the whole match uses one clock.
        const allActive = goals.every((x) => x.timeActive != null);
        let prevEnd = 0;
        for (const x of goals) {
          const xt = allActive ? x.timeActive : x.time;
          const sinceKickoff = xt - prevEnd;
          if (sinceKickoff <= 10) {
            if (x.team === g.r.team) forOff++; else againstOff++;
          }
          prevEnd = allActive ? xt : xt + 3;
        }
      }
      const w = sum(c((s) => s.possession.kickoffsWon || 0));
      const l = sum(c((s) => s.possession.kickoffsLost || 0));
      const n = sum(c((s) => s.possession.kickoffsNeutral || 0));
      return {
        won: w, lost: l, neutral: n,
        winPct: w + l > 0 ? r1((w / (w + l)) * 100) : null,
        firstTouchPct: r1(avg(c((s) => s.possession.kickoffFirstTouchPct))),
        goalsForOffKickoff: forOff,
        goalsAgainstOffKickoff: againstOff,
        perGameFor: games.length ? r1(forOff / games.length) : 0,
        perGameAgainst: games.length ? r1(againstOff / games.length) : 0,
        sample: matchesWithGoals,
      };
    })(),
    // average position per role across the career (rotation map; team modes only)
    rolePos: (() => {
      const acc = {};
      for (const g of games) {
        if (g.r.team_size < 2) continue;
        const rp = g.s.positioning.rolePos;
        if (!rp) continue;
        for (const k of ['back', 'mid', 'front']) {
          if (!rp[k]) continue;
          const a = acc[k] || (acc[k] = { x: 0, y: 0, pct: 0, n: 0 });
          a.x += rp[k].x; a.y += rp[k].y; a.pct += rp[k].pct; a.n++;
        }
      }
      const out = {};
      for (const [k, a] of Object.entries(acc)) {
        if (a.n) out[k] = { x: Math.round(a.x / a.n), y: Math.round(a.y / a.n), pct: r1(a.pct / a.n) };
      }
      return Object.keys(out).length ? out : null;
    })(),
    coaching: (() => {
      const co = buildCoaching(games, mode);
      if (!co) return null; // too few matches for coaching
      // form from the new component rating (last 10)
      const recent = myRatings.slice(-10);
      if (recent.length) { co.avgGameScore = r1(avg(recent.map((x) => x.overall))); co.sample = recent.length; }
      return co;
    })(),
    ...(() => {
      const trnR = isMe ? require('./trn').cachedRankForMode(mode) : (mode ? require('./trn').cachedPlayerRank(primaryKey, mode) : null);
      const myTier = (realTiers.length ? realTiers[realTiers.length - 1] : null) ?? trnR?.tier ?? (recentEst.length ? avg(recentEst) : null);
      const pi = computePercentiles(games, mode, myTier, keys);
      return pi
        ? { percentiles: pi.pct, percentileSource: pi.source, percentileSample: pi.sample }
        : { percentiles: null, percentileSource: null, percentileSample: null };
    })(),
    trend: games.map((g) => ({
      matchId: g.r.mid,
      date: g.r.date,
      win: g.win,
      map: g.r.map,
      teamSize: g.r.team_size,
      score: g.s.core.score,
      goals: g.s.core.goals,
      assists: g.s.core.assists,
      saves: g.s.core.saves,
      shots: g.s.core.shots,
      avgBoost: g.s.boost.avgAmount,
      avgSpeed: g.s.movement.avgSpeed,
      pctSupersonic: g.s.movement.pctSupersonic,
      possessionPct: g.s.possession.possessionPct,
      touches: g.s.possession.touches,
      xg: g.s.xg ? g.s.xg.total : null,
      estTier: calTier(g.s.estTier, calF),
      realTier: g.s.tier || null,
      rating: myRating(g)?.overall ?? null,
      kickoffWinPct: g.s.possession.kickoffWinPct ?? null,
    })),
    heatmap: heat,
  };
}

/** List of matches with a summary for the selected player (or list of my accounts). */
function matchList(playerKeyOrKeys, mode) {
  const keys = Array.isArray(playerKeyOrKeys) ? playerKeyOrKeys : (playerKeyOrKeys ? [playerKeyOrKeys] : []);
  const matches = stmts.listMatches.all().filter((m) => !mode || m.team_size === Number(mode));
  const mine = new Map();
  if (keys.length) {
    for (const r of stmts.allPlayerRows.all()) {
      if (keys.includes(r.player_key) && !mine.has(r.mid)) mine.set(r.mid, r);
    }
  }
  const ratingByMid = ratingsForMids(new Set([...mine.keys()]));
  // player names per match (for searching by opponent/teammate in the list)
  const namesByMid = new Map();
  for (const r of stmts.allPlayerRows.all()) {
    if (!mine.has(r.mid)) continue;
    const e = namesByMid.get(r.mid) || { 0: [], 1: [] };
    if (e[r.team] && !e[r.team].includes(r.name)) e[r.team].push(r.name);
    namesByMid.set(r.mid, e);
  }
  return matches.map((m) => {
    const r = mine.get(m.id);
    let me = null, opponents = [], teammates = [];
    if (r) {
      const s = JSON.parse(r.stats);
      me = {
        team: r.team, win: winForRow(r), mvp: !!r.mvp,
        goals: s.core.goals, assists: s.core.assists, saves: s.core.saves, shots: s.core.shots, score: s.core.score,
        estTier: s.estTier != null ? s.estTier : null,
        gameScore: ratingByMid.get(m.id)?.[r.player_key]?.overall ?? s.gameScore ?? null,
      };
      const names = namesByMid.get(m.id);
      if (names) {
        opponents = names[1 - r.team] || [];
        teammates = (names[r.team] || []).filter((n) => n !== r.name);
      }
    }
    return { ...m, overtime: !!m.overtime, me, opponents, teammates };
  });
}

/** Opponents (and teammates) — head-to-head stats relative to "me" (all my accounts). */
/**
 * Detailed archetype from a list of stats objects: candidates are scored from averages
 * (n01 clamp to manually calibrated ranges — a "typical" player per the benchmark
 * should land at ~0.3, a pronounced profile at 0.6+), the highest score ≥ 0.45 wins.
 * Shared by the profile (style) and the player list (opponents). When changing it,
 * also update the /info page (client/src/pages/InfoPage.jsx).
 */
function computeArchetype(statsList, mode) {
  mode = mode ? Number(mode) : null; // callers pass the query-string value — strict compares below need a number
  const A = (f) => avg(statsList.map((s) => { try { return f(s) || 0; } catch { return 0; } }));
  const n01 = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const inv01 = (v, lo, hi) => 1 - n01(v, lo, hi);
  const sig = {
    goals: A((s) => s.core.goals), assists: A((s) => s.core.assists),
    saves: A((s) => s.core.saves), shots: A((s) => s.core.shots),
    shootingPct: A((s) => s.core.shootingPct), demos: A((s) => s.core.demosInflicted),
    clears: A((s) => s.possession.clears), aerialTouches: A((s) => s.possession.aerialTouches),
    touchesPerMin: A((s) => s.possession.touchesPerMin), possessionPct: A((s) => s.possession.possessionPct),
    steals: A((s) => s.possession.steals),
    pctGround: A((s) => s.movement.pctGround), pctSupersonic: A((s) => s.movement.pctSupersonic),
    pctHighAir: A((s) => s.movement.pctHighAir), flipResets: A((s) => s.movement.flipResets),
    pctBehindBall: A((s) => s.positioning.pctBehindBall),
    doubleCommits: A((s) => s.positioning.doubleCommits),
    bigPadsStolen: A((s) => s.boost.bigPadsStolen),
    kickoffWinPct: (() => {
      const w = sum(statsList.map((s) => s.possession.kickoffsWon || 0));
      const l = sum(statsList.map((s) => s.possession.kickoffsLost || 0));
      return w + l > 0 ? (w / (w + l)) * 100 : 50;
    })(),
    kickoffFirstTouchPct: A((s) => s.possession.kickoffFirstTouchPct),
  };
  const duo = mode !== 1; // assists/rotation only make sense in 2v2/3v3
  // Ranges [typical, pronounced] calibrated to BENCHMARK AVERAGES PER MODE
  // (ballchasing corpus, mid-rank buckets): lo ≈ corpus average → a typical player
  // scores ~0, a pronounced profile 0.5–1. Without this e.g. "steals" (average 15–25/game!)
  // labeled everyone a Boost scavenger.
  const pick = (m1, m2, m3) => (mode === 1 ? m1 : mode === 3 ? m3 : m2);
  const R = {
    goals: pick([3.7, 5.5], [1.25, 2.2], [0.75, 1.4]),
    shots: pick([6.8, 10], [3.1, 5.5], [1.9, 3.5]),
    shootingPct: pick([52, 68], [35, 55], [35, 55]),
    possession: pick([49, 56], [25, 32], [16.6, 22]),
    tpm: pick([11.8, 14.5], [6.7, 9], [4.6, 6.5]),
    behindHi: pick([74, 84], [72.5, 82], [71, 81]),
    behindLo: pick([66, 74], [64.5, 72.5], [63, 71]),
    saves: pick([2.3, 4], [1.35, 2.6], [0.85, 1.8]),
    clears: pick([11, 17], [8.2, 13], [5.8, 10]),
    aerial: pick([7.5, 14], [6.8, 13], [4.5, 10]),
    pads: pick([8, 13], [6.6, 11], [5.3, 9]),
    steals: pick([22, 31], [16.3, 24], [12.3, 19]),
  };
  const candidates = {
    Striker: n01(sig.goals, ...R.goals) * 0.4 + n01(sig.shots, ...R.shots) * 0.3
      + n01(sig.shootingPct, ...R.shootingPct) * 0.3,
    Playmaker: !duo ? 0
      : n01(sig.assists / Math.max(sig.goals, 0.4), 0.5, 1.4) * 0.5
        + n01(sig.possessionPct, ...R.possession) * 0.25 + n01(sig.touchesPerMin, ...R.tpm) * 0.25,
    Ballchaser: n01(sig.touchesPerMin, ...R.tpm) * 0.3 + inv01(sig.pctBehindBall, ...R.behindLo) * 0.35
      + (duo ? n01(sig.doubleCommits, 1, 3) * 0.2 : n01(sig.pctSupersonic, 13, 22) * 0.2)
      + n01(sig.pctSupersonic, 13, 22) * 0.15,
    Lawnmower: n01(sig.pctGround, 79, 90) * 0.45 + n01(sig.pctSupersonic, 13, 22) * 0.3
      + inv01(sig.aerialTouches, 2, R.aerial[0]) * 0.25,
    'Aerial ace': n01(sig.aerialTouches, ...R.aerial) * 0.4 + n01(sig.pctHighAir, 3, 8) * 0.35
      + n01(sig.flipResets, 0.4, 2) * 0.25,
    'The Wall': n01(sig.saves, ...R.saves) * 0.4 + n01(sig.pctBehindBall, ...R.behindHi) * 0.3
      + n01(sig.clears, ...R.clears) * 0.3,
    'Demo merchant': n01(sig.demos, 1, 3) * 0.7 + n01(sig.pctSupersonic, 13, 22) * 0.3,
    'Boost scavenger': n01(sig.bigPadsStolen, ...R.pads) * 0.6 + n01(sig.steals, ...R.steals) * 0.4,
    'Kickoff bully': n01(sig.kickoffWinPct, 52, 65) * 0.6 + n01(sig.kickoffFirstTouchPct, 50, 70) * 0.4,
  };
  const ranked = Object.entries(candidates).sort((a, b) => b[1] - a[1]);
  const THR = 0.35; // with lo=corpus average, 0.35 = noticeably above average in that dimension
  return {
    archetype: ranked[0][1] >= THR ? ranked[0][0] : 'All-rounder',
    archetype2: ranked[0][1] >= THR && ranked[1][1] >= THR ? ranked[1][0] : null,
    archScores: Object.fromEntries(ranked.slice(0, 3).map(([k, v]) => [k, Math.round(v * 100) / 100])),
  };
}

function opponents(playerKeyOrKeys, mode) {
  const keys = Array.isArray(playerKeyOrKeys) ? playerKeyOrKeys : [playerKeyOrKeys];
  const calF = calibrationFactor(detectMe(), mode);
  const { cachedPlayerRank } = require('./trn');
  const all = stmts.allPlayerRows.all().filter((r) => !mode || r.team_size === Number(mode));
  const myRows = new Map();
  for (const r of all) {
    if (keys.includes(r.player_key) && !myRows.has(r.mid)) myRows.set(r.mid, r);
  }
  // my ratings per match (for teammate chemistry)
  const ratingByMid = ratingsForMids(new Set([...myRows.keys()]));
  const myRatingIn = (mid) => {
    const row = myRows.get(mid);
    return row ? ratingByMid.get(mid)?.[row.player_key]?.overall ?? null : null;
  };
  const myWins = [...myRows.values()].filter((r) => winForRow(r) > 0).length;
  const myWinPct = myRows.size ? r1((myWins / myRows.size) * 100) : null;
  const allMyRatings = [...myRows.keys()].map(myRatingIn).filter((v) => v != null);
  const myAvgRating = allMyRatings.length ? r1(avg(allMyRatings)) : null;
  const byPlayer = new Map();

  for (const r of all) {
    if (keys.includes(r.player_key)) continue;
    const my = myRows.get(r.mid);
    if (!my) continue;
    const isOpponent = r.team !== my.team;
    const key = r.player_key;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, { key, name: r.name, asOpponent: 0, asTeammate: 0, winsVs: 0, lossesVs: 0, winsWith: 0, lossesWith: 0, stats: [], estTiers: [], lastDate: null });
    }
    const e = byPlayer.get(key);
    e.name = r.name;
    e.lastDate = e.lastDate && e.lastDate > r.date ? e.lastDate : r.date;
    const myWin = winForRow(my);
    const s = JSON.parse(r.stats);
    if (s.estTier != null) e.estTiers.push(s.estTier);
    (e.allStats = e.allStats || []).push(s);
    if (isOpponent) {
      e.asOpponent++;
      if (myWin > 0) e.winsVs++; else if (myWin < 0) e.lossesVs++;
      e.stats.push(s);
    } else {
      e.asTeammate++;
      if (myWin > 0) e.winsWith++; else if (myWin < 0) e.lossesWith++;
      const mr = myRatingIn(r.mid);
      if (mr != null) { e.myRatingSum = (e.myRatingSum || 0) + mr; e.myRatingN = (e.myRatingN || 0) + 1; }
    }
  }

  const list = [...byPlayer.values()]
    .map((e) => {
      const a = (fn) => e.stats.length ? r1(avg(e.stats.map((s) => fn(s) || 0))) : null;
      return {
        key: e.key, name: e.name, lastDate: e.lastDate,
        asOpponent: e.asOpponent, asTeammate: e.asTeammate,
        winsVs: e.winsVs, lossesVs: e.lossesVs,
        winsWith: e.winsWith, lossesWith: e.lossesWith,
        winPctVs: e.asOpponent ? r1((e.winsVs / e.asOpponent) * 100) : null,
        myRatingWith: e.myRatingN ? r1(e.myRatingSum / e.myRatingN) : null,
        // learned model (GBDT → centroid) over all shared matches; fallback is the old heuristic
        estTier: (e.allStats && mode ? learnedTierEstimate(e.allStats.map((s) => ({ s })), mode) : null)
          ?? (e.estTiers.length ? calTier(avg(e.estTiers), calF) : null),
        realRank: mode ? cachedPlayerRank(e.key, mode) : null, // real rank if already fetched
        smurf: mode ? require('./trn').assessSmurf(
          require('./trn').cachedPlayerFull(e.key), mode,
          e.estTiers.length ? calTier(avg(e.estTiers), calF) : null
        ) : null,

        avg: e.stats.length ? {
          score: a((s) => s.core.score), goals: a((s) => s.core.goals), saves: a((s) => s.core.saves),
          shots: a((s) => s.core.shots), xg: a((s) => s.xg ? s.xg.total : 0),
          avgSpeed: a((s) => s.movement.avgSpeed), pctSupersonic: a((s) => s.movement.pctSupersonic),
          boostPerMin: a((s) => s.boost.usedPerMin), possessionPct: a((s) => s.possession.possessionPct),
        } : null,
        // archetype from all shared matches (≥2 games, otherwise noise)
        archetype: e.allStats && e.allStats.length >= 2
          ? computeArchetype(e.allStats, mode ? Number(mode) : null).archetype : null,
      };
    })
    .sort((x, y) => (y.asOpponent + y.asTeammate) - (x.asOpponent + x.asTeammate));
  return { list, myWinPct, myAvgRating };
}

// stats for FBref-style percentiles (invert = lower is better)
const SHEET_STATS = [
  ['goals', (s) => s.core.goals], ['assists', (s) => s.core.assists], ['shots', (s) => s.core.shots],
  ['shootingPct', (s) => s.core.shootingPct], ['xg', (s) => s.xg ? s.xg.total : 0],
  ['finishing', (s) => s.xg ? s.xg.finishing : 0], ['score', (s) => s.core.score],
  ['saves', (s) => s.core.saves], ['clears', (s) => s.possession.clears || 0],
  ['pressureClears', (s) => s.possession.pressureClears || 0], ['pctBehindBall', (s) => s.positioning.pctBehindBall],
  ['concededAsLastMan', (s) => s.possession.concededAsLastMan || 0, true],
  ['concededWhileAhead', (s) => s.positioning.concededWhileAhead || 0, true],
  ['abandoned2v1', (s) => s.positioning.abandoned2v1 || 0, true],
  ['doubleCommits', (s) => s.positioning.doubleCommits || 0, true],
  ['aheadStreakAvg', (s) => s.positioning.aheadStreakAvg || 0, true],
  ['pctLostForward', (s) => s.positioning.pctLostForward || 0, true],
  ['possessionPct', (s) => s.possession.possessionPct], ['touchesPerMin', (s) => s.possession.touchesPerMin],
  ['turnovers', (s) => s.possession.turnovers, true], ['steals', (s) => s.possession.steals],
  ['fiftyWinPct', (s) => s.possession.fiftyWinPct ?? 50], ['kickoffWinPct', (s) => s.possession.kickoffWinPct ?? 50],
  ['aerialTouches', (s) => s.possession.aerialTouches], ['avgBoost', (s) => s.boost.avgAmount],
  ['boostPerMin', (s) => s.boost.usedPerMin], ['pctZeroBoost', (s) => s.boost.pctZero, true],
  ['bigPadsStolen', (s) => s.boost.bigPadsStolen], ['avgSpeed', (s) => s.movement.avgSpeed],
  ['pctSupersonic', (s) => s.movement.pctSupersonic], ['pctHighAir', (s) => s.movement.pctHighAir],
  ['powerslides', (s) => s.movement.powerslides || 0],
  ['powerslidesPerMin', (s) => s.movement.powerslidesPerMin || 0],
  ['flipResets', (s) => s.movement.flipResets || 0],
  ['demos', (s) => s.core.demosInflicted], ['demosTaken', (s) => s.core.demosTaken, true],
];

/**
 * FBref-style percentiles: my average against the averages of ALL players in the database (same mode).
 * Pool = players with ≥2 matches; percentile = % of players worse than me (with half credit for ties).
 */
// cache of parsed benchmark stats per mode (JSON.parse of thousands of rows is expensive)
const benchCache = new Map(); // mode -> { t, rows: [{ stats, bucket }] }
function getBenchStats(mode) {
  const key = Number(mode);
  const hit = benchCache.get(key);
  // the corpus is large (100k+ rows after bulk imports) and changes slowly —
  // re-parsing it every 2 minutes would stall requests
  if (hit && Date.now() - hit.t < 15 * 60 * 1000) return hit.rows;
  let rows = [];
  try {
    rows = stmts.benchPlayerRows.all(key).map((r) => {
      try { return { stats: JSON.parse(r.stats), bucket: r.bench_bucket, mid: r.mid, playerKey: r.player_key }; } catch { return null; }
    }).filter(Boolean);
  } catch { /* no benchmark data */ }
  benchCache.set(key, { t: Date.now(), rows });
  return rows;
}

// central tier of each bucket (0-22 scale)
const BUCKET_TIERS = { bronze: 2, silver: 5, gold: 8, platinum: 11, diamond: 14, champion: 17, 'grand-champion': 20, ssl: 22 };

/**
 * Centroid (mean/sd per SHEET_STATS) for an ARBITRARY tier: linear interpolation
 * between bucket anchors (BUCKET_TIERS). Enables the "gap to the next sub-rank".
 */
function benchCentroidAtTier(model, tier) {
  const pts = Object.entries(BUCKET_TIERS)
    .map(([b, t]) => ({ t, m: model.find((x) => x.bucket === b) }))
    .filter((p) => p.m && p.m.n >= 30)
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  if (tier <= pts[0].t) return pts[0].m;
  if (tier >= pts[pts.length - 1].t) return pts[pts.length - 1].m;
  let lo = pts[0], hi = pts[pts.length - 1];
  for (let i = 0; i < pts.length - 1; i++) {
    if (tier >= pts[i].t && tier <= pts[i + 1].t) { lo = pts[i]; hi = pts[i + 1]; break; }
  }
  const f = (tier - lo.t) / (hi.t - lo.t);
  return {
    n: Math.min(lo.m.n, hi.m.n),
    mean: lo.m.mean.map((v, i) => v + (hi.m.mean[i] - v) * f),
    sd: lo.m.sd.map((v, i) => v + (hi.m.sd[i] - v) * f),
  };
}

/**
 * Cached benchmark "model": per bucket, the first and second moment (mean/sd) of each
 * SHEET_STATS metric. Computed once per mode (shares the TTL with the getBenchStats cache),
 * so individual estimates (profile, per-game in a match, opponents) are cheap.
 */
const benchModelCache = new Map(); // mode -> { t, model: [{ bucket, tier, n, mean[], sd[] }] }
function getBenchModel(mode) {
  const key = Number(mode);
  const hit = benchModelCache.get(key);
  if (hit && Date.now() - hit.t < 120 * 1000) return hit.model;
  const rows = getBenchStats(mode);
  const byBucket = {};
  for (const r of rows) (byBucket[r.bucket] = byBucket[r.bucket] || []).push(r.stats);
  const model = Object.entries(byBucket)
    .filter(([b, arr]) => BUCKET_TIERS[b] != null && arr.length >= 80)
    .map(([bucket, arr]) => {
      const mean = [], sd = [];
      SHEET_STATS.forEach(([, get], i) => {
        const vals = arr.map((s) => get(s) || 0);
        const m = avg(vals);
        mean[i] = m;
        sd[i] = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
      });
      return { bucket, tier: BUCKET_TIERS[bucket], n: arr.length, mean, sd };
    });
  benchModelCache.set(key, { t: Date.now(), model });
  return model;
}

/**
 * Learned rank estimator: compare the player's averages with rank bucket centroids
 * from the ballchasing benchmark (z-distance across all SHEET_STATS metrics,
 * softmax weights → weighted tier). Active only when ≥5 buckets have ≥80 players.
 */
function benchTierEstimate(games, mode, keys = null) {
  if (!mode || !games.length) return null;
  const model = getBenchModel(mode);
  if (model.length < 5) return null;
  const idx = SHEET_STATS
    .map(([k], i) => (!keys || keys.includes(k) ? i : -1))
    .filter((i) => i >= 0);
  if (!idx.length) return null;
  const myVals = idx.map((i) => avg(games.map((g) => SHEET_STATS[i][1](g.s) || 0)));
  let wSum = 0, tSum = 0;
  for (const b of model) {
    let d2 = 0;
    idx.forEach((i, j) => {
      const z = (myVals[j] - b.mean[i]) / Math.max(b.sd[i], Math.abs(b.mean[i]) * 0.15 + 0.3);
      d2 += Math.min(9, z * z);
    });
    const w = Math.exp(-(d2 / idx.length) / 1.2);
    wSum += w; tSum += w * b.tier;
  }
  return wSum > 0 ? r1(tSum / wSum) : null;
}

/**
 * Best available tier estimate: the GBDT model (calibrated on tracker.gg) if it is
 * trained, otherwise the centroid/softmax model. Categories (archetype) stay centroid —
 * GBDT is overall-only, and mixing scales would distort the deltas.
 */
function learnedTierEstimate(games, mode) {
  try {
    const t = require('./gbdt').estimateTier(games, mode);
    if (t != null) return t;
  } catch { /* model not trained */ }
  return benchTierEstimate(games, mode);
}

// stat groups for the archetype estimate (mirrors categories from client statDefs.js)
const BENCH_CATS = {
  Attack: ['goals', 'assists', 'shots', 'shootingPct', 'xg', 'finishing', 'score'],
  Defense: ['saves', 'clears', 'pressureClears', 'pctBehindBall', 'concededAsLastMan', 'concededWhileAhead', 'demosTaken'],
  Rotation: ['abandoned2v1', 'doubleCommits', 'aheadStreakAvg', 'pctLostForward', 'turnovers', 'steals'],
  'Possession & duels': ['possessionPct', 'touchesPerMin', 'fiftyWinPct', 'kickoffWinPct', 'aerialTouches', 'demos'],
  Boost: ['avgBoost', 'boostPerMin', 'pctZeroBoost', 'bigPadsStolen'],
  Movement: ['avgSpeed', 'pctSupersonic', 'pctHighAir', 'powerslides', 'powerslidesPerMin', 'flipResets'],
};

/**
 * Archetype from the benchmark: the same centroid/softmax model as benchTierEstimate,
 * but separately per stat category → "you attack like a Champ, defend like a Gold".
 */
function benchCategoryTiers(games, mode) {
  const overall = benchTierEstimate(games, mode);
  if (overall == null) return null;
  const cats = {};
  for (const [cat, keys] of Object.entries(BENCH_CATS)) {
    const t = benchTierEstimate(games, mode, keys);
    if (t != null) cats[cat] = t;
  }
  return Object.keys(cats).length ? { overall, cats } : null;
}

// tier (0-22) → ballchasing bucket name
function tierToBucket(tier) {
  if (tier == null) return null;
  if (tier <= 3) return 'bronze';
  if (tier <= 6) return 'silver';
  if (tier <= 9) return 'gold';
  if (tier <= 12) return 'platinum';
  if (tier <= 15) return 'diamond';
  if (tier <= 18) return 'champion';
  if (tier <= 21) return 'grand-champion';
  return 'ssl';
}

/**
 * Percentiles. If there is enough ballchasing benchmark data for the mode,
 * the reference population is players of the SAME rank (bucket from the real/estimated rank);
 * otherwise fallback: all players from my matches.
 * Returns { pct: {...}, source: string }.
 */
function computePercentiles(myGames, mode, myTier = null, myKeys = []) {
  const pctAgainst = (vals, mine, invert) => {
    let below = 0, equal = 0;
    for (const v of vals) { if (v < mine) below++; else if (v === mine) equal++; }
    let pct = ((below + equal * 0.5) / vals.length) * 100;
    if (invert) pct = 100 - pct;
    return Math.round(pct);
  };

  // 1) benchmark population (ballchasing) for that mode and my rank bucket
  if (mode) {
    const bucket = tierToBucket(myTier);
    // use the benchmark ONLY when there are enough players of exactly MY rank —
    // comparing a Champ with Bronzes would be worse than the old comparison
    const pool = bucket ? getBenchStats(mode).filter((r) => r.bucket === bucket) : [];
    if (pool.length >= 200) {
      const source = `${bucket} players (ballchasing, ${mode}v${mode})`;
      const out = {};
      for (const [key, get, invert] of SHEET_STATS) {
        const mine = avg(myGames.map((g) => get(g.s) || 0));
        const vals = pool.map((r) => get(r.stats) || 0);
        out[key] = pctAgainst(vals, mine, invert);
      }
      return { pct: out, source, sample: pool.length };
    }
  }

  // 2) fallback: players from my matches (average per player, min 2 matches);
  // the profiled player (and their alt accounts) is excluded — being in your own
  // comparison pool shaves the top percentiles
  const all = stmts.allPlayerRows.all().filter((r) => !mode || r.team_size === Number(mode));
  const byPlayer = new Map();
  for (const r of all) {
    if (myKeys.includes(r.player_key)) continue;
    if (!byPlayer.has(r.player_key)) byPlayer.set(r.player_key, []);
    byPlayer.get(r.player_key).push(JSON.parse(r.stats));
  }
  const pool = [...byPlayer.values()].filter((g) => g.length >= 2);
  if (pool.length < 4) return null; // sample too small for meaningful percentiles
  const out = {};
  for (const [key, get, invert] of SHEET_STATS) {
    const mine = avg(myGames.map((g) => get(g.s) || 0));
    const vals = pool.map((g) => avg(g.map((s) => get(s) || 0)));
    out[key] = pctAgainst(vals, mine, invert);
  }
  return { pct: out, source: 'players from your matches', sample: pool.length };
}

/**
 * Coaching analysis (Pacifist-style): find the biggest "leaks" in the game
 * over the last ~10 matches and suggest ONE focus for training.
 */
function buildCoaching(games, mode) {
  const recent = games.slice(-10);
  if (recent.length < 3) return null;
  const c = (fn) => recent.map((g) => fn(g.s) || 0);
  const a = (fn) => avg(c(fn));
  const sumW = (fn) => sum(c(fn));

  const fiftyW = sumW((s) => s.possession.fiftiesWon || 0);
  const fiftyL = sumW((s) => s.possession.fiftiesLost || 0);
  const fiftyPct = fiftyW + fiftyL > 0 ? (fiftyW / (fiftyW + fiftyL)) * 100 : null;
  const koW = sumW((s) => s.possession.kickoffsWon || 0);
  const koL = sumW((s) => s.possession.kickoffsLost || 0);
  const koPct = koW + koL > 0 ? (koW / (koW + koL)) * 100 : null;
  const isTeamMode = !mode || Number(mode) > 1;

  // candidates: [condition-severity 0-100, title, diagnosis, advice]
  const leaks = [];
  const add = (sev, title, diag, advice) => { if (sev > 0) leaks.push({ sev: Math.round(sev), title, diag, advice }); };

  if (fiftyPct != null) add((48 - fiftyPct) * 3, '50/50 challenges', `Winning only ${r1(fiftyPct)}% of challenges`,
    'Go in second ("flip second"), aim for the center of the ball, do not jump early. Practice: 1v1 duels.');
  add((a((s) => s.possession.turnovers) - a((s) => s.possession.steals) - 2) * 12, 'Turnovers', `${r1(a((s) => s.possession.turnovers))} lost vs ${r1(a((s) => s.possession.steals))} won per game`,
    'Stop forcing dribbles through the middle — use backboard passes and walls. Do not touch the ball without control.');
  add((a((s) => s.boost.pctZero) - 22) * 3, 'Boost economy', `At 0 boost ${r1(a((s) => s.boost.pctZero))}% of the time`,
    'Rotate over small pads (12 boost is often enough) instead of chasing big pads. Keep a 30+ reserve for defense.');
  if (koPct != null) add((45 - koPct) * 2.5, 'Kickoffs', `Winning ${r1(koPct)}% of kickoffs`,
    isTeamMode
      ? 'Learn the speed flip; grab the small pad in front at spawn; coordinate cheats in 2v2.'
      : 'Learn the speed flip; grab the small pad in front at spawn; in 1v1 a safe, consistent kickoff beats a risky fast one.');
  add((a((s) => s.possession.concededAsLastMan) - 0.7) * 40, 'Last line of defense', `${r1(a((s) => s.possession.concededAsLastMan))} goals conceded per game as last man`,
    'As last man, do not challenge balls you cannot reach first — hold shadow defense positioning.');
  if (isTeamMode) add((a((s) => s.positioning.doubleCommits || 0) - 2.5) * 15, 'Double commits', `${r1(a((s) => s.positioning.doubleCommits || 0))} double commits per game`,
    'Check your teammate before committing. If they are closer — you are second man, cover the next play.');
  if (isTeamMode) add((a((s) => s.positioning.abandoned2v1 || 0) - 1.5) * 25, 'Leaving teammate in a 2v1', `${r1(a((s) => s.positioning.abandoned2v1 || 0))}× per game your teammate defends alone while you are forward`,
    'Recover immediately after a failed attack — a counter should never catch your teammate alone.');
  add((a((s) => s.positioning.concededWhileAhead || 0) - 0.8) * 35, 'Caught upfield on conceded goals', `${r1(a((s) => s.positioning.concededWhileAhead || 0))}× per game caught in the attacking half when conceding`,
    'Review your conceded goals: where were you at that moment? Rotate back the moment possession is lost.');
  add(((a((s) => s.xg ? -s.xg.finishing : 0)) - 0.2) * 50, 'Finishing', `Scoring below expected (G−xG per game: ${r1(a((s) => s.xg ? s.xg.finishing : 0))})`,
    'Shooting practice: consistency training packs. In games pick the safer corner over power.');
  add((55 - a((s) => s.positioning.pctBehindBall)) * 3, 'Rotation', `Behind the ball only ${r1(a((s) => s.positioning.pctBehindBall))}% of the time`,
    'After a touch rotate BACK through your own half, not through the middle. Target: 65%+ behind ball.');

  leaks.sort((x, y) => y.sev - x.sev);
  const strengths = [];
  if (fiftyPct != null && fiftyPct >= 55) strengths.push(`50/50 challenges (${r1(fiftyPct)}%)`);
  if (koPct != null && koPct >= 55) strengths.push(`kickoffs (${r1(koPct)}%)`);
  if (a((s) => s.xg ? s.xg.finishing : 0) > 0.5) strengths.push('finishing above expected (xG)');
  if (a((s) => s.core.saves) >= 2) strengths.push('saves');
  if (a((s) => s.boost.bigPadsStolen) >= 3) strengths.push('boost stealing');

  return {
    sample: recent.length,
    mainLeak: leaks[0] || null,
    secondLeak: leaks[1] || null,
    leaks: leaks.slice(0, 8), // focus (top 3) + action plan: problems with concrete advice
    focus: leaks[0] ? leaks[0].advice : null,
    strengths,
    avgGameScore: r1(a((s) => s.gameScore || 50)),
  };
}

/**
 * Rank estimate calibration factor: anchor = my real rank (tracker.gg) in that mode
 * against my average of estimates. Scales ALL players in that mode (same lobbies).
 */
function calibrationFactor(meKey, mode) {
  if (!mode || !meKey) return 1;
  const trnRank = require('./trn').cachedRankForMode(mode);
  if (!trnRank || trnRank.tier == null) return 1;
  const ests = stmts.allPlayerRows.all()
    .filter((r) => r.player_key === meKey && r.team_size === Number(mode))
    .map((r) => JSON.parse(r.stats).estTier)
    .filter((v) => v != null);
  if (!ests.length) return 1;
  const f = trnRank.tier / (ests.reduce((a, b) => a + b, 0) / ests.length);
  return Math.max(0.6, Math.min(1.8, f));
}

function calTier(v, factor) {
  return v == null ? null : Math.round(Math.min(22, v * factor) * 10) / 10;
}

function getManualTier(mode) {
  if (!mode) return null;
  const row = stmts.getSetting.get('manual_tier_' + mode);
  return row && row.value != null ? Number(row.value) : null;
}

module.exports = {
  detectMe, meName, myKeys, profile, matchList, winForRow, opponents, getManualTier,
  calibrationFactor, calTier, SHEET_STATS, getBenchStats, tierToBucket, BUCKET_TIERS,
  benchCategoryTiers, benchTierEstimate, learnedTierEstimate,
};
