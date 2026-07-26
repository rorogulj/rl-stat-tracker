'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { analyze } = require('./analyzer');
const { stmts, saveAnalysis } = require('./db');

const RRROCKET = path.join(__dirname, '..', '..', 'tools', 'rrrocket.exe');

function defaultReplayDir() {
  if (process.env.RL_REPLAY_DIR) return process.env.RL_REPLAY_DIR;
  const base = path.join(os.homedir(), 'Documents', 'My Games', 'Rocket League', 'TAGame');
  for (const sub of ['DemosEpic', 'Demos']) {
    const p = path.join(base, sub);
    if (fs.existsSync(p)) return p;
  }
  return path.join(base, 'DemosEpic');
}

const REPLAY_DIR = defaultReplayDir();

// import status (for /api/status and frontend progress)
const progress = { running: false, total: 0, done: 0, current: null, errors: [], lastRun: null };

function parseReplayFile(fullPath) {
  const r = spawnSync(RRROCKET, ['--network-parse', '--json-lines', fullPath], {
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error((r.stderr || 'rrrocket failed').slice(0, 500));
  return JSON.parse(r.stdout);
}

function pendingFiles() {
  if (!fs.existsSync(REPLAY_DIR)) return [];
  const done = new Map(stmts.importedFiles.all().map((r) => [r.file, r.status]));
  return fs.readdirSync(REPLAY_DIR)
    .filter((f) => f.toLowerCase().endsWith('.replay'))
    .filter((f) => done.get(f) !== 'ok');
}

function importOne(file) {
  const full = path.join(REPLAY_DIR, file);
  try {
    const data = parseReplayFile(full);
    const a = analyze(data, file);
    saveAnalysis(a);
    stmts.logImport.run(file, 'ok', null);
    return { ok: true, id: a.id };
  } catch (e) {
    stmts.logImport.run(file, 'error', String(e.message || e).slice(0, 500));
    progress.errors.push({ file, error: String(e.message || e).slice(0, 200) });
    return { ok: false, error: e };
  }
}

const RANK_REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // refreshing other players' ranks: monthly

/**
 * Priority queue for ranks: players from the NEWEST matches go first.
 * Already fetched (fresh cache) are skipped; stops as soon as tracker.gg blocks.
 */
async function refreshRanksQueue({ limit = 40 } = {}) {
  const trn = require('./trn');
  if (trn.isBlocked()) return;
  try {
    // my rank always first and more often (MMR history, calibration)
    const meKey = require('./aggregate').detectMe();
    const meRow = meKey && stmts.playerCounts.all().find((r) => r.player_key === meKey);
    if (meRow) await trn.fetchPlayerRanks(meKey, meRow.name, { ttlMs: 60 * 60 * 1000 }).catch(() => {});

    let n = 0;
    for (const p of stmts.playersByLastMatch.all()) {
      if (trn.isBlocked() || n >= limit) break;
      const row = stmts.getPlayerRank.get(p.player_key);
      const fresh = row && row.data && row.data.length > 2 && Date.now() - row.fetched_at < RANK_REFRESH_MS;
      if (fresh) continue; // already fetched and fresh → skip
      const r = await trn.fetchPlayerRanks(p.player_key, p.name, { ttlMs: RANK_REFRESH_MS }).catch(() => null);
      n++;
      if (r && r.rateLimited) break;
      await new Promise((ok) => setTimeout(ok, 2800));
    }
    if (n) console.log('[trn] rank queue: processed', n, 'players (newest matches first)');
  } catch (e) {
    console.log('[trn] rank queue error:', e.message);
  }
}

/** Background rank fetching after import — the queue is already ordered by match date. */
async function fetchRanksInBackground() {
  return refreshRanksQueue({ limit: 40 });
}

let queued = false;
async function importAll() {
  if (progress.running) { queued = true; return; }
  const files = pendingFiles();
  if (!files.length) return;
  progress.running = true;
  progress.total = files.length;
  progress.done = 0;
  progress.errors = [];
  const importedIds = [];
  try {
    for (const file of files) {
      progress.current = file;
      const r = importOne(file);
      if (r.ok) importedIds.push(r.id);
      progress.done++;
      // let the event loop breathe (API stays responsive)
      await new Promise((res) => setImmediate(res));
    }
    // ranks — in the background, without waiting (queue: newest matches first)
    if (importedIds.length) fetchRanksInBackground();
  } finally {
    progress.running = false;
    progress.current = null;
    progress.lastRun = new Date().toISOString();
    if (queued) { queued = false; importAll(); }
  }
}

function watch(onImported) {
  if (!fs.existsSync(REPLAY_DIR)) return;
  const chokidar = require('chokidar');
  const watcher = chokidar.watch(REPLAY_DIR, {
    ignoreInitial: true, depth: 0,
    awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 },
  });
  watcher.on('add', (p) => {
    if (!p.toLowerCase().endsWith('.replay')) return;
    console.log('[watch] new replay:', path.basename(p));
    importAll().then(() => onImported && onImported());
  });
}

/** Compatibility with old call sites — everything goes through the priority queue. */
async function refetchMissingRanks() {
  return refreshRanksQueue({ limit: 60 });
}

// ---------- benchmark replays (ballchasing, benchmark-replays/ folder) ----------
const BENCH_DIR = path.join(__dirname, '..', '..', 'benchmark-replays');
const benchProgress = { running: false, imported: 0, pending: 0, errors: 0 };

function benchPendingFiles() {
  if (!fs.existsSync(BENCH_DIR)) return [];
  const done = new Map(stmts.importedFiles.all().map((r) => [r.file, r.status]));
  return fs.readdirSync(BENCH_DIR)
    .filter((f) => f.toLowerCase().endsWith('.replay'))
    .filter((f) => done.get(f) !== 'ok' && done.get(f) !== 'error'); // errors are not retried (broken replay)
}

/** Import new benchmark replays (light storage, benchmark=1 + rank bucket from the file name). */
async function importBenchmarks() {
  if (benchProgress.running || progress.running) return;
  const files = benchPendingFiles();
  if (!files.length) return;
  benchProgress.running = true;
  benchProgress.pending = files.length;
  console.log('[bench] importing', files.length, 'benchmark replays…');
  try {
    for (const file of files) {
      const bucket = file.includes('__') ? file.split('__')[0] : null;
      try {
        const data = parseReplayFile(path.join(BENCH_DIR, file));
        const a = analyze(data, file);
        saveAnalysis(a, { benchmark: 1, bucket });
        stmts.logImport.run(file, 'ok', null);
        benchProgress.imported++;
      } catch (e) {
        stmts.logImport.run(file, 'error', String(e.message || e).slice(0, 300));
        benchProgress.errors++;
      }
      benchProgress.pending--;
      if (benchProgress.imported % 25 === 0 && benchProgress.imported > 0) {
        console.log('[bench] imported', benchProgress.imported);
      }
      await new Promise((res) => setImmediate(res));
      if (progress.running) break; // personal import takes priority — continue later
    }
  } finally {
    benchProgress.running = false;
    console.log('[bench] round done (total imported:', benchProgress.imported + ')');
  }
}

// download corpus targets (must match JOBS in tools/benchmark-download.mjs)
const BENCH_TARGETS = [
  { playlist: 'ranked-doubles', target: 1000 },
  { playlist: 'ranked-duels', target: 1600 },
  { playlist: 'ranked-standard', target: 800 },
];

/**
 * Downloader auto-resume: corpus phase 2 takes days, and the downloader does not survive
 * a reboot — the server (which starts itself at login) restarts it if the targets are not
 * met and the log hasn't moved for >15 min (the downloader logs every ~3 min; the 429 pause is 10 min).
 */
function resumeBenchDownload() {
  try {
    const manifestPath = path.join(BENCH_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const per = {};
    for (const d of Object.values(man.downloaded || {})) {
      const pl = d.playlist || 'ranked-doubles';
      per[pl] = (per[pl] || 0) + 1;
    }
    const unmet = BENCH_TARGETS.some((j) => (per[j.playlist] || 0) < j.target * 8);
    if (!unmet) return;
    const logPath = path.join(BENCH_DIR, 'download.log');
    const logStat = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
    const manStat = fs.statSync(manifestPath);
    const lastActivity = Math.max(logStat ? logStat.mtimeMs : 0, manStat.mtimeMs);
    if (Date.now() - lastActivity < 15 * 60 * 1000) return; // probably already running
    const root = path.join(__dirname, '..', '..');
    console.log('[bench-dl] targets not met and the downloader is idle — starting it');
    // the downloader writes to download.log itself — a shell redirect through cmd.exe kept getting lost
    require('child_process').spawn(process.execPath,
      [path.join(root, 'tools', 'benchmark-download.mjs')],
      { cwd: root, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    console.log('[bench-dl] auto-resume error:', e.message);
  }
}

module.exports = { importAll, pendingFiles, progress, REPLAY_DIR, watch, refetchMissingRanks, refreshRanksQueue, importBenchmarks, benchProgress, BENCH_DIR, resumeBenchDownload };
