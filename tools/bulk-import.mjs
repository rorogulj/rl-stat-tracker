// Parallel bulk import of an external replay dataset (kaggle-replays/{1v1,2v2,3v3})
// into the benchmark corpus. Rank buckets are derived from the replays themselves
// (ranked matches replicate every player's SkillTier); files without tiers
// (private/casual lobbies) are skipped. Resumable via import_log; run with
// --dry --limit 20 first to inspect the bucket distribution without writing.
//
//   node tools/bulk-import.mjs [--dir kaggle-replays] [--limit N] [--dry] [--workers N]
//
// Stop the tracker server first — the database wants a single writer.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RRROCKET = path.join(ROOT, 'tools', 'rrrocket.exe');
const SELF = fileURLToPath(import.meta.url);

// ---------------- worker: parse + analyze, strip heavy fields ----------------
if (!isMainThread) {
  const { spawnSync } = require('node:child_process');
  const { analyze } = require(path.join(ROOT, 'server', 'src', 'analyzer.js'));
  parentPort.on('message', (file) => {
    try {
      const r = spawnSync(RRROCKET, ['--network-parse', '--json-lines', file], {
        encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024,
      });
      if (r.status !== 0) throw new Error((r.stderr || 'rrrocket failed').slice(0, 200));
      const a = analyze(JSON.parse(r.stdout), path.basename(file));
      delete a.timeline;
      for (const p of a.players) { delete p.heatmap; delete p.touchPoints; }
      parentPort.postMessage({ file, ok: true, a });
    } catch (e) {
      parentPort.postMessage({ file, ok: false, error: String(e.message || e).slice(0, 200) });
    }
  });
} else {
  // ---------------- main: dispatch, label, write ----------------
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : dflt;
  };
  const DIR = path.resolve(ROOT, String(arg('dir', 'kaggle-replays')));
  const LIMIT = Number(arg('limit', 0)) || 0;      // per mode folder
  const DRY = !!arg('dry', false);
  const WORKERS = Number(arg('workers', 0)) || Math.max(2, os.cpus().length - 2);

  if (!fs.existsSync(RRROCKET)) { console.error('rrrocket.exe missing — run: node tools/fetch-rrrocket.mjs'); process.exit(1); }

  const { stmts, saveAnalysis } = require(path.join(ROOT, 'server', 'src', 'db.js'));
  const { tierToBucket } = require(path.join(ROOT, 'server', 'src', 'aggregate.js'));

  // labels: scan.json (roster + playlist per file) × player-tiers.json (ballchasing
  // ranks at match time). Only RANKED replays whose roster is sufficiently covered
  // get imported — private scrims and unlabeled matches are skipped up front.
  const scan = JSON.parse(fs.readFileSync(path.join(DIR, 'scan.json'), 'utf8'));
  const { obs } = JSON.parse(fs.readFileSync(path.join(DIR, 'player-tiers.json'), 'utf8'));
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const isRanked = (r) => /ranked (duel|doubles|standard)/i.test(r.rn || '');
  const labelFor = (id) => {
    const r = scan[id];
    if (!r || !isRanked(r)) return null;
    const known = r.players.map((p) => obs[p.id]).filter(Boolean).map(median);
    if (known.length < Math.max(1, Math.ceil(r.players.length / 2))) return null;
    return tierToBucket(Math.round(known.reduce((a, b) => a + b, 0) / known.length));
  };

  const done = new Set(stmts.importedFiles.all().filter((r) => r.status === 'ok').map((r) => r.file));
  const queue = [];
  let notRanked = 0, unlabeled = 0;
  for (const mode of ['1v1', '2v2', '3v3']) {
    const d = path.join(DIR, mode);
    if (!fs.existsSync(d)) continue;
    let files = fs.readdirSync(d).filter((f) => f.endsWith('.replay'));
    for (const f of files) {
      if (LIMIT && queue.length >= LIMIT * 3) break;
      const logKey = `kaggle/${mode}/${f}`;
      if (done.has(logKey)) continue;
      const id = path.basename(f, '.replay');
      const r = scan[id];
      if (!r || !isRanked(r)) { notRanked++; continue; }
      const bucket = labelFor(id);
      if (!bucket || bucket === 'bronze') { unlabeled++; continue; }
      queue.push({ full: path.join(d, f), logKey, expectSize: Number(mode[0]), bucket });
    }
  }
  console.log(`${queue.length} labeled ranked replays to process (skipped: ${notRanked} not-ranked, ${unlabeled} unlabeled) (${WORKERS} workers${DRY ? ', DRY RUN' : ''})`);
  if (!queue.length) process.exit(0);

  const buckets = {}; const skips = {}; let doneN = 0, imported = 0, failed = 0;
  const t0 = Date.now();
  let qi = 0;

  const workers = Array.from({ length: WORKERS }, () => new Worker(SELF));
  let alive = workers.length;

  const dispatch = (w) => {
    if (qi >= queue.length) { w.terminate(); alive--; if (!alive) finish(); return; }
    const job = queue[qi++];
    w.job = job;
    w.postMessage(job.full);
  };

  const finish = () => {
    console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    console.log(`imported: ${imported}, failed: ${failed}, skipped:`, skips);
    console.log('bucket distribution:', buckets);
    process.exit(0);
  };

  for (const w of workers) {
    w.on('message', (msg) => {
      const job = w.job;
      doneN++;
      if (!msg.ok) {
        failed++;
        if (!DRY) stmts.logImport.run(job.logKey, 'error', msg.error);
      } else {
        const a = msg.a;
        let skip = null;
        if (a.teamSize !== job.expectSize) skip = 'wrong-size';
        if (skip) {
          skips[skip] = (skips[skip] || 0) + 1;
          if (!DRY) stmts.logImport.run(job.logKey, 'ok', `skipped:${skip}`);
        } else {
          const bucket = job.bucket;
          buckets[bucket] = (buckets[bucket] || 0) + 1;
          if (!DRY) {
            try {
              saveAnalysis(a, { benchmark: 1, bucket });
              stmts.logImport.run(job.logKey, 'ok', null);
              imported++;
            } catch (e) {
              failed++;
              stmts.logImport.run(job.logKey, 'error', String(e.message || e).slice(0, 200));
            }
          } else imported++;
        }
      }
      if (doneN % 250 === 0) {
        const rate = doneN / ((Date.now() - t0) / 60000);
        const eta = (queue.length - doneN) / rate;
        console.log(`${doneN}/${queue.length} · ${Math.round(rate)}/min · ETA ${(eta / 60).toFixed(1)} h · buckets ${JSON.stringify(buckets)}`);
      }
      dispatch(w);
    });
    w.on('error', (e) => { console.error('worker error:', e.message); failed++; dispatch(w); });
    dispatch(w);
  }
}
