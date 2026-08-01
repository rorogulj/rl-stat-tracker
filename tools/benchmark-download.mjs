/**
 * Ballchasing benchmark downloader — downloads a stratified sample of ranked 2v2 replays
 * (per rank bucket) into ONE folder: benchmark-replays/ (shareable).
 *
 * - respects the free API limits (file download: 1/s and 200/h → ~18.5 s per file)
 * - resume: manifest.json remembers what was downloaded; re-running continues where it left off
 * - run with:  node tools/benchmark-download.mjs   (or npm run benchmark:download)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'benchmark-replays');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const KEY_FILE = path.join(ROOT, 'server', 'data', 'ballchasing.key');

const DATE_AFTER = '2026-01-01T00:00:00Z'; // only fresh replays (current meta)
// starved buckets (ssl duels, bronze/silver standard…) run out of the 2026 window —
// when a list is drained we reach back into 2025 rather than sit at 10% of target
const DATE_AFTER_FALLBACK = '2025-01-01T00:00:00Z';
const FILE_DELAY_MS = 18500; // 200/h limit → 1 file / 18.5 s

// download order; per-bucket target scaled by players per match.
// Phase 2 (23 Jul): targets ×4 — goal ~4000+ player-performances per bucket per mode
// for the GBDT rank model (the lists fill up with new replays over time; resume continues).
const JOBS = [
  { playlist: 'ranked-doubles', target: 1000 },  // 4 players/match → 4000/bucket
  { playlist: 'ranked-duels', target: 1600 },    // 2 players/match → 3200/bucket
  { playlist: 'ranked-standard', target: 800 },  // 6 players/match → 4800/bucket
];

const BUCKETS = [
  ['bronze', 'bronze-1', 'bronze-3'],
  ['silver', 'silver-1', 'silver-3'],
  ['gold', 'gold-1', 'gold-3'],
  ['platinum', 'platinum-1', 'platinum-3'],
  ['diamond', 'diamond-1', 'diamond-3'],
  ['champion', 'champion-1', 'champion-3'],
  ['grand-champion', 'grand-champion-1', 'grand-champion-3'],
  ['ssl', 'supersonic-legend', 'supersonic-legend'],
];

const KEY = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : null;
if (!KEY) { console.error('No API key in ' + KEY_FILE); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  : { dateAfter: DATE_AFTER, downloaded: {}, failed: {} };
// older entries have no playlist field → they were ranked-doubles
for (const d of Object.values(manifest.downloaded)) if (!d.playlist) d.playlist = 'ranked-doubles';
const saveManifest = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));

const ts = () => new Date().toISOString().slice(11, 19);
// log goes both to stdout and directly to download.log — the shell redirect is lost when
// the server auto-resume spawns us, so we write the file ourselves (the Server tab reads its tail)
const LOG_FILE = path.join(OUT_DIR, 'download.log');
const log = (...a) => {
  const line = `[${ts()}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: KEY } }).catch(() => null);
    if (res && res.status === 429) {
      log('429 rate limit — pausing 10 min');
      await sleep(10 * 60 * 1000);
      continue;
    }
    if (!res || !res.ok) {
      if (attempt >= 3) return null;
      await sleep(5000 * (attempt + 1));
      continue;
    }
    return res;
  }
}

/**
 * Collect `need` NEW ids for playlist+bucket (listing is cheap: 2/s, 500/h).
 * Ids already in the manifest (incl. under an adjacent bucket — the rank filters overlap
 * at boundaries, so the same replay shows up in two lists) don't count toward `need`;
 * we page past them until enough fresh ones are found or the list runs out.
 */
async function listBucket(playlist, minRank, maxRank, need, dateAfter = DATE_AFTER, dateBefore = null) {
  const base = `https://ballchasing.com/api/replays?playlist=${playlist}&min-rank=${minRank}&max-rank=${maxRank}`
    + `&replay-date-after=${encodeURIComponent(dateAfter)}&count=200&sort-by=replay-date&sort-dir=desc`;
  const mk = (before) => base + (before ? `&replay-date-before=${encodeURIComponent(before)}` : '');
  const fresh = [];
  const seen = new Set();
  let url = mk(dateBefore);
  for (let pages = 0; fresh.length < need && url && pages < 150; pages++) {
    const res = await api(url);
    if (!res) break;
    const data = await res.json();
    const page = data.list || [];
    for (const r of page) {
      if (fresh.length >= need) break;
      if (seen.has(r.id) || manifest.downloaded[r.id] || manifest.failed[r.id]) continue;
      seen.add(r.id);
      fresh.push({ id: r.id, date: r.date, minRank: r.min_rank?.id, maxRank: r.max_rank?.id });
    }
    // fallback when the cursor runs out but the page was full: continue by date
    url = data.next
      || (page.length === 200 ? mk(page[page.length - 1].date) : null);
    await sleep(600);
  }
  return fresh;
}

async function downloadOne(playlist, bucket, entry) {
  const fname = `${bucket}__${entry.id}.replay`;
  const fpath = path.join(OUT_DIR, fname);
  if (manifest.downloaded[entry.id] && fs.existsSync(fpath)) return 'skip';
  const res = await api(`https://ballchasing.com/api/replays/${entry.id}/file`);
  if (!res) {
    manifest.failed[entry.id] = { playlist, bucket, at: Date.now() };
    saveManifest();
    return 'fail';
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10000) { // file too small = error/JSON error body
    manifest.failed[entry.id] = { playlist, bucket, at: Date.now(), size: buf.length };
    saveManifest();
    return 'fail';
  }
  fs.writeFileSync(fpath, buf);
  manifest.downloaded[entry.id] = { playlist, bucket, file: fname, date: entry.date, minRank: entry.minRank, maxRank: entry.maxRank };
  saveManifest();
  return 'ok';
}

const doneIn = (playlist, bucket) =>
  Object.values(manifest.downloaded).filter((d) => d.playlist === playlist && d.bucket === bucket).length;

(async () => {
  log('=== ballchasing benchmark download ===');
  for (const j of JOBS) log('  plan:', j.playlist, '×', j.target, 'per bucket ×', BUCKETS.length, 'buckets');
  const totalDone = () => Object.keys(manifest.downloaded).length;
  const startTotal = totalDone();
  log('already downloaded (resume):', startTotal);

  for (const { playlist, target } of JOBS) {
    log(`--- playlist ${playlist} (target ${target}/bucket) ---`);
    for (const [bucket, minRank, maxRank] of BUCKETS) {
      const have = doneIn(playlist, bucket);
      if (have >= target) { log(`${playlist}/${bucket}: done (${have})`); continue; }
      log(`${playlist}/${bucket}: have ${have}, fetching list…`);
      const need = target - have + 20;
      const entries = await listBucket(playlist, minRank, maxRank, need);
      if (entries.length < need) {
        // 2026 window drained — reach back into 2025 for the remainder
        const older = await listBucket(playlist, minRank, maxRank, need - entries.length, DATE_AFTER_FALLBACK, DATE_AFTER);
        if (older.length) entries.push(...older);
        log(`${playlist}/${bucket}: listed ${entries.length} new replays (${older.length} from the 2025 window)`);
      } else {
        log(`${playlist}/${bucket}: listed ${entries.length} new replays`);
      }
      for (const e of entries) {
        if (doneIn(playlist, bucket) >= target) break;
        const r = await downloadOne(playlist, bucket, e);
        if (r === 'ok') {
          const n = totalDone();
          if (n % 10 === 0) log(`total: ${n} (${playlist}/${bucket}: ${doneIn(playlist, bucket)}/${target})`);
          await sleep(FILE_DELAY_MS);
        } else if (r === 'fail') {
          await sleep(FILE_DELAY_MS);
        }
        // 'skip' doesn't use an API call → no pause
      }
      log(`${playlist}/${bucket}: finished with ${doneIn(playlist, bucket)}`);
    }
  }
  // state for the server's auto-resume: a run that added nothing means the lists
  // are drained — the resume backs off to a daily retry instead of hourly
  fs.writeFileSync(path.join(OUT_DIR, 'download-state.json'),
    JSON.stringify({ finishedAt: new Date().toISOString(), added: totalDone() - startTotal }));
  log('=== DONE — total:', totalDone(), 'replays in', OUT_DIR, '===');
})();
