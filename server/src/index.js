'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const { stmts } = require('./db');
const importer = require('./importer');
const { detectMe, myKeys, profile, matchList, opponents } = require('./aggregate');

const PORT = process.env.PORT || 7845;
const app = express();
app.use(express.json());

// ---------- log ring buffer (for the Server tab in the UI) ----------
const STARTED_AT = Date.now();
const LOG_BUF = [];
{
  const orig = console.log;
  console.log = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    if (line.trim()) {
      LOG_BUF.push({ t: Date.now(), line: line.slice(0, 300) });
      if (LOG_BUF.length > 400) LOG_BUF.splice(0, LOG_BUF.length - 400);
    }
    orig(...args);
  };
}

// ---------- API ----------
app.get('/api/status', (req, res) => {
  let bench = null;
  try {
    const counts = stmts.benchCounts.all();
    bench = {
      matches: counts.reduce((a, c) => a + c.matches, 0),
      players: counts.reduce((a, c) => a + c.players, 0),
      buckets: counts.map((c) => ({ bucket: c.bucket, mode: c.team_size, matches: c.matches })),
      importing: importer.benchProgress.running,
      pendingFiles: importer.benchProgress.running ? importer.benchProgress.pending : undefined,
    };
  } catch { /* no benchmark data */ }
  res.json({
    version: require('./update').VERSION,
    dev: require('./update').isDevCheckout,
    replayDir: importer.REPLAY_DIR,
    replayDirExists: fs.existsSync(importer.REPLAY_DIR),
    pending: importer.pendingFiles().length,
    progress: importer.progress,
    matches: stmts.listMatches.all().length,
    me: detectMe(),
    bench,
  });
});

// ---------- self-update ----------
app.get('/api/update', async (req, res) => {
  res.json(await require('./update').check(req.query.force === '1'));
});

app.post('/api/update/run', (req, res) => {
  const upd = require('./update');
  if (upd.isDevCheckout) {
    return res.status(400).json({ error: 'dev checkout — update with git pull' });
  }
  res.json({ started: true });
  setTimeout(() => {
    try { upd.runUpdate(); } catch (e) { console.log('[update] failed to start:', e.message); }
  }, 300);
});

app.post('/api/import', (req, res) => {
  importer.importAll();
  res.json({ started: true });
});

app.get('/api/players', (req, res) => {
  res.json({ me: detectMe(), players: stmts.playerCounts.all() });
});

app.get('/api/matches', (req, res) => {
  const who = req.query.player || myKeys();
  res.json({ me: detectMe(), matches: matchList(who, req.query.mode) });
});

app.get('/api/matches/:id/timeline', (req, res) => {
  const row = stmts.getTimeline.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.type('application/json').send(row.data);
});

app.get('/api/opponents', (req, res) => {
  const who = req.query.player || myKeys();
  const o = opponents(who, req.query.mode);
  res.json({ me: detectMe(), opponents: o.list, myWinPct: o.myWinPct, myAvgRating: o.myAvgRating });
});

app.get('/api/settings', (req, res) => {
  const out = {};
  for (const m of ['1', '2', '3']) {
    const row = stmts.getSetting.get('manual_tier_' + m);
    out[m] = row && row.value != null ? Number(row.value) : null;
  }
  const acc = stmts.getSetting.get('my_accounts');
  let myAccounts = [];
  try { myAccounts = acc && acc.value ? JSON.parse(acc.value) : []; } catch { /* empty */ }
  res.json({ manualTiers: out, myAccounts, autoMe: detectMe() });
});

app.post('/api/settings', (req, res) => {
  if ('manualTier' in req.body && req.body.mode) {
    const v = req.body.manualTier;
    stmts.setSetting.run('manual_tier_' + req.body.mode, v == null ? null : String(v));
  }
  if ('myAccounts' in req.body) {
    // list of my accounts; empty list = automatic (most matches)
    const arr = Array.isArray(req.body.myAccounts) ? req.body.myAccounts : [];
    stmts.setSetting.run('my_accounts', JSON.stringify(arr));
    // immediately fetch the primary account's rank in the background (for estimate calibration)
    const me = require('./aggregate').detectMe();
    const row = me && stmts.playerCounts.all().find((r) => r.player_key === me);
    if (row) require('./trn').fetchPlayerRanks(me, row.name, { ttlMs: 60 * 60 * 1000 }).catch(() => {});
  }
  res.json({ ok: true });
});

// ---- favorite players (stored in the settings table as a JSON list) ----
function getFavorites() {
  try {
    const row = stmts.getSetting.get('favorite_players');
    return row && row.value ? JSON.parse(row.value) : [];
  } catch { return []; }
}
app.get('/api/favorites', (req, res) => res.json({ favorites: getFavorites() }));
app.post('/api/favorites/toggle', (req, res) => {
  const { key, name } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  let favs = getFavorites();
  const was = favs.some((f) => f.key === key);
  favs = was ? favs.filter((f) => f.key !== key)
    : [...favs, { key, name: name || key, added: new Date().toISOString() }];
  stmts.setSetting.run('favorite_players', JSON.stringify(favs));
  res.json({ favorites: favs, favorited: !was });
});

// MMR history (for the progress chart)
app.get('/api/rank-history', (req, res) => {
  const me = detectMe();
  if (!me) return res.json({ history: [] });
  const rows = stmts.getRankHistory.all(me).filter((r) => !req.query.mode || r.mode === req.query.mode);
  res.json({ history: rows });
});

// benchmark: my metrics vs expected for my real rank
app.get('/api/benchmark', (req, res) => {
  const mode = req.query.mode;
  if (!mode) return res.json(null);
  const me = detectMe();
  const trnRank = require('./trn').cachedRankForMode(mode);
  if (!me || !trnRank || trnRank.tier == null) return res.json(null);
  const { expectedForTier, BENCHMARKS } = require('./analyzer');
  const rows = stmts.allPlayerRows.all().filter((r) => r.player_key === me && r.team_size === Number(mode));
  if (!rows.length) return res.json(null);
  const statsArr = rows.map((r) => JSON.parse(r.stats));
  const expected = expectedForTier(trnRank.tier, Number(mode));
  const nextTier = Math.min(22, trnRank.tier + 1);
  const expectedNext = expectedForTier(nextTier, Number(mode));
  const out = BENCHMARKS.map((b, i) => {
    const mine = statsArr.reduce((a, s) => a + (b.get(s) || 0), 0) / statsArr.length;
    return {
      label: b.label,
      mine: Math.round(mine * 10) / 10,
      expected: expected[i].expected,
      diffPct: expected[i].expected ? Math.round(((mine - expected[i].expected) / expected[i].expected) * 100) : null,
      expectedNext: expectedNext[i].expected,
      diffNextPct: expectedNext[i].expected ? Math.round(((mine - expectedNext[i].expected) / expectedNext[i].expected) * 100) : null,
    };
  });
  res.json({ tierName: trnRank.tierName, tier: trnRank.tier, nextTier, rows: out });
});

// real rank of the tracked account (platform-aware; 1 h cache; ?refresh=1 to force)
app.get('/api/rank', async (req, res) => {
  try {
    const me = detectMe();
    const row = me && stmts.playerCounts.all().find((r) => r.player_key === me);
    if (!row) return res.json({ error: 'unknown player' });
    const data = await require('./trn').fetchPlayerRanks(me, row.name, {
      force: req.query.refresh === '1', ttlMs: 60 * 60 * 1000,
    });
    res.json({
      name: row.name, platform: data.platform, playlists: data.ranks,
      peaks: data.full ? data.full.peaks : {}, lifetime: data.full ? data.full.lifetime : null,
      casualMmr: data.full ? data.full.casualMmr : null, stale: !!data.stale,
    });
  } catch (e) {
    res.json({ error: String(e.message || e) });
  }
});

app.get('/api/matches/:id', (req, res) => {
  const m = stmts.getMatch.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const { calibrationFactor, calTier, learnedTierEstimate } = require('./aggregate');
  const { cachedPlayerRank, cachedRankForMode } = require('./trn');
  const me = detectMe();
  const mode = String(m.team_size);
  const calF = calibrationFactor(me, mode);
  const { cachedPlayerFull, assessSmurf } = require('./trn');
  const meta = JSON.parse(m.meta || '{}');
  const rawPlayers = stmts.getMatchPlayers.all(m.id).map((r) => ({ r, s: JSON.parse(r.stats) }));
  // component rating with full context (score, clutch from meta)
  const ratings = require('./rating').matchRatings(
    rawPlayers.map(({ r, s }) => ({ key: r.player_key, name: r.name, team: r.team, stats: s })),
    { meta, score0: m.team0_score, score1: m.team1_score, teamSize: m.team_size }
  );
  // "lobby prior": average of KNOWN ranks in this match (tracker cache + my rank) —
  // a ranked lobby is MMR-matched, so a single player's estimate must not drift far from it
  const knownTiers = rawPlayers
    .map(({ r }) => (cachedPlayerRank(r.player_key, mode) || {}).tier)
    .filter((t) => t != null && t > 0);
  const myTrn = cachedRankForMode(mode);
  if (myTrn && myTrn.tier != null && rawPlayers.some(({ r }) => r.player_key === me)) knownTiers.push(myTrn.tier);
  const lobbyPrior = knownTiers.length ? knownTiers.reduce((a, b) => a + b, 0) / knownTiers.length : null;
  const players = rawPlayers.map(({ r, s }) => {
    const estCal = calTier(s.estTier, calF);
    // estimate from the learned model (GBDT → centroid) on THIS match's stats;
    // falls back to the old heuristic until a benchmark for the mode exists
    const perfEst = learnedTierEstimate([{ s }], mode) ?? estCal;
    // displayed estimate: shrunk toward the lobby prior (one good/bad game ≠ a new rank)
    let estShown = perfEst;
    if (estShown != null && lobbyPrior != null) {
      estShown = Math.max(lobbyPrior - 2.5, Math.min(lobbyPrior + 2.5, 0.45 * estShown + 0.55 * lobbyPrior));
    }
    const rating = ratings[r.player_key] || null;
    return {
      key: r.player_key, name: r.name, team: r.team, bot: !!r.is_bot, mvp: !!r.mvp,
      ...s,
      gameScore: rating ? rating.overall : s.gameScore, // new component rating
      rating,
      estTier: estShown != null ? Math.round(estShown * 10) / 10 : null,
      estTierRaw: perfEst, // unshrunk estimate (for the smurf signal and debugging)
      realRank: cachedPlayerRank(r.player_key, mode), // from cache if already fetched
      realRanks: (cachedPlayerFull(r.player_key) || {}).playlists || null, // all modes (1/2/3) from cache
      smurf: assessSmurf(cachedPlayerFull(r.player_key), mode, perfEst),
    };
  });
  const mine = myKeys();
  res.json({
    ...m, overtime: !!m.overtime, meta,
    players,
    me: (players.find((p) => mine.includes(p.key)) || {}).key || me, // my account in THIS match
  });
});

// real ranks of all players in the match from tracker.gg (7-day cache per player)
app.get('/api/matches/:id/ranks', async (req, res) => {
  const m = stmts.getMatch.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const trn = require('./trn');
  const players = stmts.getMatchPlayers.all(m.id);
  const out = [];
  for (const r of players) {
    try {
      const cached = stmts.getPlayerRank.get(r.player_key);
      const hasRealData = cached && cached.data && cached.data.length > 2;
      const wasCached = hasRealData && Date.now() - cached.fetched_at < 7 * 24 * 60 * 60 * 1000;
      // the button forces a retry even for players whose previous fetch failed (empty cache)
      const data = await trn.fetchPlayerRanks(r.player_key, r.name, { force: req.query.refresh === '1' || !hasRealData });
      out.push({ key: r.player_key, name: r.name, ...data });
      if (!wasCached) await new Promise((ok) => setTimeout(ok, 800)); // polite gap between API calls
    } catch (e) {
      out.push({ key: r.player_key, name: r.name, error: true });
    }
  }
  res.json({ mode: String(m.team_size), players: out, rateLimited: trn.isBlocked() });
});

app.get('/api/profile', (req, res) => {
  const who = req.query.player || myKeys();
  if (!who || (Array.isArray(who) && !who.length)) return res.json(null);
  res.json(profile(who, req.query.mode));
});

// ---------- rank ladder: stat curves across ranks (ballchasing benchmark) ----------
app.get('/api/rank-ladder', (req, res) => {
  const agg = require('./aggregate');
  const mode = String(req.query.mode || '2');
  const rows = agg.getBenchStats(mode);
  const order = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion', 'grand-champion', 'ssl'];
  const byBucket = {};
  for (const r of rows) (byBucket[r.bucket] = byBucket[r.bucket] || []).push(r.stats);

  const pctile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const buckets = order.filter((b) => (byBucket[b] || []).length >= 40).map((b) => {
    const arr = byBucket[b];
    const stats = {};
    for (const [key, get] of agg.SHEET_STATS) {
      // shooting%: ratio-of-means (total goals / total shots) like ballchasing —
      // averaging per-match percentages is dragged down by shotless matches (0%) and a small shot base
      if (key === 'shootingPct') {
        const g = arr.reduce((a, s) => a + (s.core.goals || 0), 0);
        const sh = arr.reduce((a, s) => a + (s.core.shots || 0), 0);
        const vals = arr.filter((s) => (s.core.shots || 0) > 0).map((s) => s.core.shootingPct).sort((x, y) => x - y);
        stats[key] = {
          mean: sh > 0 ? Math.round((g / sh) * 10000) / 100 : 0,
          p25: vals.length ? Math.round(pctile(vals, 0.25) * 100) / 100 : null,
          p75: vals.length ? Math.round(pctile(vals, 0.75) * 100) / 100 : null,
        };
        continue;
      }
      const vals = arr.map((s) => get(s) || 0).sort((x, y) => x - y);
      const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
      stats[key] = { mean: Math.round(mean * 100) / 100, p25: Math.round(pctile(vals, 0.25) * 100) / 100, p75: Math.round(pctile(vals, 0.75) * 100) / 100 };
    }
    return { bucket: b, players: arr.length, stats };
  });

  // my averages for the "you are here" marker
  const keys = myKeys();
  const myRows = stmts.allPlayerRows.all().filter((r) => keys.includes(r.player_key) && r.team_size === Number(mode));
  const myGames = myRows.map((r) => JSON.parse(r.stats));
  const me = {};
  if (myGames.length) {
    for (const [key, get] of agg.SHEET_STATS) {
      me[key] = Math.round((myGames.reduce((a, s) => a + (get(s) || 0), 0) / myGames.length) * 100) / 100;
    }
    const myG = myGames.reduce((a, s) => a + (s.core.goals || 0), 0);
    const mySh = myGames.reduce((a, s) => a + (s.core.shots || 0), 0);
    me.shootingPct = mySh > 0 ? Math.round((myG / mySh) * 10000) / 100 : 0;
  }
  const trnRank = require('./trn').cachedRankForMode(mode);
  const arch = myGames.length ? agg.benchCategoryTiers(myGames.map((s) => ({ s })), mode) : null;
  // overall onto the calibrated GBDT scale; shift the categories by the same amount (the relative
  // structure — the point of the card — stays intact, absolute values without bias)
  if (arch) {
    try {
      const g = require('./gbdt').estimateTier(myGames.map((s) => ({ s })), mode);
      if (g != null) {
        const shift = g - arch.overall;
        arch.cats = Object.fromEntries(Object.entries(arch.cats)
          .map(([k, v]) => [k, Math.round(Math.max(0, Math.min(22, v + shift)) * 10) / 10]));
        arch.overall = g;
        arch.src = 'gbdt';
      }
    } catch { /* centroid fallback */ }
  }
  res.json({
    mode,
    buckets,
    totalPlayers: rows.length,
    me: myGames.length ? me : null,
    myGames: myGames.length,
    myBucket: agg.tierToBucket(trnRank?.tier ?? null),
    myTier: trnRank?.tier ?? null,
    arch,
  });
});

// ---------- server status (Server tab): what, how much, when, where ----------
app.get('/api/server', (req, res) => {
  const { db, DATA_DIR, DB_PATH } = require('./db');
  const safeStat = (p) => { try { return fs.statSync(p); } catch { return null; } };

  // database
  const dbStat = safeStat(DB_PATH);
  const walStat = safeStat(DB_PATH + '-wal');
  const counts = {};
  for (const [k, sql] of [
    ['matches', 'SELECT COUNT(*) n FROM matches WHERE benchmark = 0'],
    ['benchMatches', 'SELECT COUNT(*) n FROM matches WHERE benchmark = 1'],
    ['playerRows', 'SELECT COUNT(*) n FROM player_stats'],
    ['timelines', 'SELECT COUNT(*) n FROM timelines'],
    ['rankCache', 'SELECT COUNT(*) n FROM player_ranks'],
    ['rankCacheEmpty', 'SELECT COUNT(*) n FROM player_ranks WHERE LENGTH(data) <= 2'],
  ]) {
    try { counts[k] = db.prepare(sql).get().n; } catch { counts[k] = null; }
  }

  // benchmark download (folder + manifest + log)
  const benchDir = importer.BENCH_DIR;
  let benchDl = null;
  try {
    const manifestPath = path.join(benchDir, 'manifest.json');
    const files = fs.existsSync(benchDir) ? fs.readdirSync(benchDir).filter((f) => f.endsWith('.replay')).length : 0;
    // corpus phase 2: targets ×4 (must match JOBS in tools/benchmark-download.mjs)
    const jobs = [
      { playlist: 'ranked-doubles', label: '2v2', target: 1000 },
      { playlist: 'ranked-duels', label: '1v1', target: 1600 },
      { playlist: 'ranked-standard', label: '3v3', target: 800 },
    ];
    let perJob = {}, downloaded = 0, failed = 0;
    for (const j of jobs) perJob[j.playlist] = {};
    // regular installs have no corpus — hide the whole section instead of showing zeros
    if (!fs.existsSync(manifestPath) && files === 0) throw new Error('no corpus');
    if (fs.existsSync(manifestPath)) {
      const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      downloaded = Object.keys(man.downloaded || {}).length;
      failed = Object.keys(man.failed || {}).length;
      for (const d of Object.values(man.downloaded || {})) {
        const pl = d.playlist || 'ranked-doubles';
        if (!perJob[pl]) perJob[pl] = {};
        perJob[pl][d.bucket] = (perJob[pl][d.bucket] || 0) + 1;
      }
    }
    const manStat = safeStat(manifestPath);
    const logPath = path.join(benchDir, 'download.log');
    let logTail = [];
    const logStat = safeStat(logPath);
    if (logStat) {
      const fd = fs.openSync(logPath, 'r');
      const start = Math.max(0, logStat.size - 4096);
      const buf = Buffer.alloc(logStat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      logTail = buf.toString('utf8').split('\n').filter(Boolean).slice(-12);
    }
    const lastActivity = Math.max(manStat ? manStat.mtimeMs : 0, logStat ? logStat.mtimeMs : 0);
    benchDl = {
      folder: benchDir,
      files, downloaded, failed,
      jobs: jobs.map((j) => ({ ...j, perBucket: perJob[j.playlist] || {}, done: Object.values(perJob[j.playlist] || {}).reduce((a, b) => a + b, 0) })),
      target: jobs.reduce((a, j) => a + j.target * 8, 0),
      active: lastActivity > 0 && Date.now() - lastActivity < 120 * 1000,
      lastActivity: lastActivity || null,
      logTail,
    };
  } catch { /* no download info */ }

  // benchmark import (in the database)
  let benchImport = null;
  try {
    const rows = stmts.benchCounts.all();
    benchImport = {
      matches: rows.reduce((a, c) => a + c.matches, 0),
      players: rows.reduce((a, c) => a + c.players, 0),
      perBucket: Object.fromEntries(rows.map((c) => [c.bucket, c.matches])),
      running: importer.benchProgress.running,
      pending: importer.benchProgress.running ? importer.benchProgress.pending : 0,
    };
  } catch { /* none */ }

  res.json({
    now: Date.now(),
    startedAt: STARTED_AT,
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    port: PORT,
    pid: process.pid,
    node: process.version,
    version: require('./update').VERSION,
    replayDir: importer.REPLAY_DIR,
    dataDir: DATA_DIR,
    db: {
      path: DB_PATH,
      sizeMB: dbStat ? Math.round(((dbStat.size + (walStat ? walStat.size : 0)) / 1048576) * 10) / 10 : null,
      ...counts,
    },
    import: {
      pending: importer.pendingFiles().length,
      progress: importer.progress,
    },
    benchDl,
    benchImport,
    gbdt: (() => { try { return require('./gbdt').info(); } catch { return null; } })(),
    logs: LOG_BUF.slice(-100),
  });
});

// ---------- backup / restore ----------
app.get('/api/backup', (req, res) => {
  const { db, DATA_DIR } = require('./db');
  const tmp = path.join(DATA_DIR, 'backup-tmp.db');
  try { fs.unlinkSync(tmp); } catch { /* not there */ }
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); // consistent copy even with WAL
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
  const name = 'rl-stat-tracker-backup-' + new Date().toISOString().slice(0, 10) + '.db';
  res.download(tmp, name, () => { try { fs.unlinkSync(tmp); } catch { /* ignore */ } });
});

app.post('/api/restore', express.raw({ type: () => true, limit: '2gb' }), (req, res) => {
  const { DATA_DIR } = require('./db');
  if (!req.body || req.body.length < 1024) return res.status(400).json({ error: 'empty or invalid file' });
  if (req.body.slice(0, 15).toString('utf8') !== 'SQLite format 3') {
    return res.status(400).json({ error: 'not a SQLite database file' });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'restore-pending.db'), req.body);
  res.json({ ok: true, restarting: true });
  // restart: spawn a new process (with a listen retry on the port) then exit — db.js applies the restore at boot
  setTimeout(() => {
    const { spawn } = require('child_process');
    spawn(process.execPath, [__filename], {
      detached: true, stdio: 'ignore', cwd: path.join(__dirname, '..'),
      env: { ...process.env, RL_LISTEN_RETRY: '1' },
    }).unref();
    process.exit(0);
  }, 400);
});

// ---------- static files (built frontend) ----------
const DIST = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(DIST)) {
  // Vite assets have a hash in the name → may be cached forever; index.html never
  // (otherwise the browser can hold an old index.html pointing to deleted assets)
  app.use(express.static(DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(path.sep + 'assets' + path.sep)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(path.join(DIST, 'index.html'));
    }
    next();
  });
}

const srv = app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ██████╗ ██╗      ███████╗████████╗ █████╗ ████████╗███████╗');
  console.log('  RL STAT TRACKER — http://localhost:' + PORT);
  console.log('  Replay folder: ' + importer.REPLAY_DIR);
  console.log('');
  // initial import + watcher + tracker cache top-up in the background
  importer.importAll();
  importer.watch();
  setTimeout(() => importer.refreshRanksQueue({ limit: 60 }), 8000);
  // continuous slow rank fetching (newest matches first; stops under rate limit)
  setInterval(() => importer.refreshRanksQueue({ limit: 20 }), 10 * 60 * 1000);
  // benchmark replays (ballchasing folder): import new ones at boot, then every 10 min
  setTimeout(() => importer.importBenchmarks(), 20000);
  setInterval(() => importer.importBenchmarks(), 10 * 60 * 1000);
  // downloader auto-resume (corpus phase 2 takes days — survives a reboot)
  setTimeout(() => importer.resumeBenchDownload(), 90 * 1000);
  setInterval(() => importer.resumeBenchDownload(), 60 * 60 * 1000);
  // GBDT rank model: train at boot if missing/stale, then check periodically
  setTimeout(() => require('./gbdt').ensureModels(), 30 * 1000);
  setInterval(() => require('./gbdt').ensureModels(), 6 * 60 * 60 * 1000);
  // published models (GitHub): pick up newer ones at boot, then daily
  setTimeout(() => require('./gbdt').syncRemoteModels(), 25 * 1000);
  setInterval(() => require('./gbdt').syncRemoteModels(), 24 * 60 * 60 * 1000);
  if (process.argv.includes('--open')) {
    require('child_process').exec('start http://localhost:' + PORT);
  }
});

// already running (e.g. auto-start + manual) → exit quietly;
// exception: restart after a restore (RL_LISTEN_RETRY) waits for the old process to release the port
let listenTries = 0;
srv.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    if (process.env.RL_LISTEN_RETRY && listenTries < 20) {
      listenTries++;
      setTimeout(() => srv.listen(PORT, '127.0.0.1'), 500);
      return;
    }
    // check WHO holds the port: a second copy of the tracker is fine (exit quietly),
    // but a foreign application must not be mistaken for one
    fetch(`http://localhost:${PORT}/api/status`, { signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s) => {
        if (s && s.version != null && s.replayDir != null) {
          console.log('Server already running on port ' + PORT + ' — exiting.');
          process.exit(0);
        }
        throw new Error('not ours');
      })
      .catch(() => {
        console.log('Port ' + PORT + ' is in use by ANOTHER application — close it and start the tracker again.');
        process.exit(1);
      });
    return;
  }
  throw e;
});
