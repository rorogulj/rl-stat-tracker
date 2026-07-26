'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// installed copies (install.ps1) keep data outside the app dir so updates can
// replace the code without touching the database — they set RL_DATA_DIR
const DATA_DIR = process.env.RL_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'stats.db');

// restore from backup: /api/restore saves the file and restarts the server;
// here (before opening the database) we replace stats.db, keeping the old one as .bak
const PENDING_RESTORE = path.join(DATA_DIR, 'restore-pending.db');
if (fs.existsSync(PENDING_RESTORE)) {
  try {
    for (const suf of ['-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + suf); } catch { /* not there */ }
    }
    if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.bak');
    fs.renameSync(PENDING_RESTORE, DB_PATH);
    console.log('[db] database restored from backup (old one kept as stats.db.bak)');
  } catch (e) {
    console.log('[db] restore failed:', e.message);
    try { fs.unlinkSync(PENDING_RESTORE); } catch { /* ignore */ }
  }
}

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    name TEXT,
    map TEXT,
    match_type TEXT,
    team_size INTEGER,
    date TEXT,
    duration REAL,
    overtime INTEGER,
    team0_score INTEGER,
    team1_score INTEGER,
    meta TEXT,          -- JSON: goals, fieldTilt, ballHeatmap, teamPossession, demoEvents
    imported_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS player_stats (
    match_id TEXT NOT NULL,
    player_key TEXT NOT NULL,
    name TEXT NOT NULL,
    team INTEGER NOT NULL,
    is_bot INTEGER DEFAULT 0,
    mvp INTEGER DEFAULT 0,
    stats TEXT NOT NULL, -- JSON: core, boost, movement, positioning, possession, heatmap, touchPoints
    PRIMARY KEY (match_id, player_key),
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS import_log (
    file TEXT PRIMARY KEY,
    status TEXT,
    error TEXT,
    imported_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS timelines (
    match_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS rank_history (
    player_key TEXT NOT NULL,
    mode TEXT NOT NULL,
    mmr INTEGER,
    tier INTEGER,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (player_key, mode, fetched_at)
  );
  CREATE TABLE IF NOT EXISTS player_ranks (
    player_key TEXT PRIMARY KEY,
    name TEXT,
    platform TEXT,
    data TEXT,          -- JSON: ranks per playlist
    fetched_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_ps_player ON player_stats(player_key);
  CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
`);

// benchmark columns (reference ballchasing matches — separate from personal stats)
try { db.exec('ALTER TABLE matches ADD COLUMN benchmark INTEGER DEFAULT 0'); } catch { /* exists */ }
try { db.exec('ALTER TABLE matches ADD COLUMN bench_bucket TEXT'); } catch { /* exists */ }

// delete the old tracker cache format (v2 adds peaks/lifetime) — refetch happens in the background
const trnSchema = db.prepare(`SELECT value FROM settings WHERE key = 'trn_schema'`).get();
if (!trnSchema || trnSchema.value !== '2') {
  db.exec(`DELETE FROM player_ranks;`);
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('trn_schema', '2')`).run();
}

// auto-reimport when the analyzer version changes
const { ANALYZER_VERSION } = require('./analyzer');
const verRow = db.prepare(`SELECT value FROM settings WHERE key = 'analyzer_version'`).get();
if (!verRow || Number(verRow.value) !== ANALYZER_VERSION) {
  db.exec(`DELETE FROM player_stats; DELETE FROM timelines; DELETE FROM matches; DELETE FROM import_log;`);
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('analyzer_version', ?)`).run(String(ANALYZER_VERSION));
  console.log('[db] new analyzer version → reimporting all replays');
}

const stmts = {
  insertMatch: db.prepare(`
    INSERT OR REPLACE INTO matches (id, file, name, map, match_type, team_size, date, duration, overtime, team0_score, team1_score, meta, benchmark, bench_bucket)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  insertPlayer: db.prepare(`
    INSERT OR REPLACE INTO player_stats (match_id, player_key, name, team, is_bot, mvp, stats)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  logImport: db.prepare(`INSERT OR REPLACE INTO import_log (file, status, error) VALUES (?, ?, ?)`),
  importedFiles: db.prepare(`SELECT file, status FROM import_log`),
  listMatches: db.prepare(`SELECT id, file, name, map, match_type, team_size, date, duration, overtime, team0_score, team1_score FROM matches WHERE benchmark = 0 ORDER BY date DESC`),
  getMatch: db.prepare(`SELECT * FROM matches WHERE id = ?`),
  getMatchPlayers: db.prepare(`SELECT * FROM player_stats WHERE match_id = ?`),
  allPlayerRows: db.prepare(`
    SELECT ps.*, m.date, m.team0_score, m.team1_score, m.team_size, m.map, m.match_type, m.overtime, m.duration, m.id AS mid
    FROM player_stats ps JOIN matches m ON m.id = ps.match_id WHERE m.benchmark = 0 ORDER BY m.date ASC`),
  playerCounts: db.prepare(`
    SELECT ps.player_key, MAX(ps.name) AS name, COUNT(*) AS matches, SUM(ps.is_bot) AS bot_matches
    FROM player_stats ps JOIN matches m ON m.id = ps.match_id WHERE m.benchmark = 0
    GROUP BY ps.player_key ORDER BY matches DESC`),
  // benchmark rows (reference population per rank and mode)
  benchPlayerRows: db.prepare(`
    SELECT ps.stats, ps.player_key, ps.match_id AS mid, m.bench_bucket, m.team_size
    FROM player_stats ps JOIN matches m ON m.id = ps.match_id WHERE m.benchmark = 1 AND m.team_size = ?`),
  benchCounts: db.prepare(`
    SELECT m.bench_bucket AS bucket, m.team_size, COUNT(DISTINCT m.id) AS matches, COUNT(*) AS players
    FROM player_stats ps JOIN matches m ON m.id = ps.match_id WHERE m.benchmark = 1
    GROUP BY m.bench_bucket, m.team_size`),
  insertTimeline: db.prepare(`INSERT OR REPLACE INTO timelines (match_id, data) VALUES (?, ?)`),
  getTimeline: db.prepare(`SELECT data FROM timelines WHERE match_id = ?`),
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`),
  getPlayerRank: db.prepare(`SELECT * FROM player_ranks WHERE player_key = ?`),
  // players ordered by their last played match (newest first) — for priority rank fetching
  playersByLastMatch: db.prepare(`
    SELECT ps.player_key, MAX(ps.name) AS name, MAX(m.date) AS last_date
    FROM player_stats ps JOIN matches m ON m.id = ps.match_id WHERE m.benchmark = 0
    GROUP BY ps.player_key ORDER BY last_date DESC`),
  setPlayerRank: db.prepare(`INSERT OR REPLACE INTO player_ranks (player_key, name, platform, data, fetched_at) VALUES (?, ?, ?, ?, ?)`),
  addRankHistory: db.prepare(`INSERT OR REPLACE INTO rank_history (player_key, mode, mmr, tier, fetched_at) VALUES (?, ?, ?, ?, ?)`),
  getRankHistory: db.prepare(`SELECT mode, mmr, tier, fetched_at FROM rank_history WHERE player_key = ? ORDER BY fetched_at ASC`),
};

function saveAnalysis(a, { benchmark = 0, bucket = null } = {}) {
  // benchmark matches: no heatmaps/touchPoints/timeline (saves disk — only the numbers are needed)
  const light = !!benchmark;
  const meta = JSON.stringify(light ? {
    goals: a.goals, totalSeconds: a.totalSeconds, teamXg: a.teamXg, teamPossession: a.teamPossession,
  } : {
    goals: a.goals, fieldTilt: a.fieldTilt, ballHeatmap: a.ballHeatmap,
    teamPossession: a.teamPossession, demoEvents: a.demoEvents, totalSeconds: a.totalSeconds,
    teamXg: a.teamXg,
  });
  db.exec('BEGIN');
  try {
    stmts.insertMatch.run(a.id, a.file, a.name, a.map, a.matchType, a.teamSize, a.date,
      a.duration, a.overtime ? 1 : 0, a.team0Score, a.team1Score, meta, benchmark ? 1 : 0, bucket);
    for (const p of a.players) {
      const stats = JSON.stringify({
        core: p.core, boost: p.boost, movement: p.movement, positioning: p.positioning,
        possession: p.possession, timePlayed: p.timePlayed,
        heatmap: light ? undefined : p.heatmap, touchPoints: light ? undefined : p.touchPoints,
        epicId: p.epicId, xg: light ? { ...p.xg, shots: undefined } : p.xg,
        tier: p.tier, estTier: p.estTier, perfRating: p.perfRating,
        style: light ? undefined : p.style, gameScore: p.gameScore,
      });
      stmts.insertPlayer.run(a.id, p.key, p.name, p.team, p.bot ? 1 : 0, p.mvp ? 1 : 0, stats);
    }
    if (a.timeline && !light) stmts.insertTimeline.run(a.id, JSON.stringify(a.timeline));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, stmts, saveAnalysis, DATA_DIR, DB_PATH };
