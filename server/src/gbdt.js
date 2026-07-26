'use strict';
/**
 * Pure-JS histogram GBDT (LightGBM-style) — rank model, variant (b).
 *
 * Regression onto rank tier (2–22, ordinal bucket scale) from per-game SHEET_STATS
 * features of benchmark player rows. No dependencies; trains in Node at boot
 * (~seconds on 20k rows), the model is saved to server/data/gbdt-rank-<mode>.json.
 *
 * Calibration: the raw prediction learns ballchasing label semantics (rank at recording
 * time, whole season) which is ~2–3 tiers below today's tracker.gg ranks.
 * calibration(mode) fits a linear pred→tracker correction on players from MY matches
 * with a known (cached) real rank.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

// models shipped with the app (published from the dev machine's corpus via
// `npm run publish-models`) and models auto-downloaded from GitHub at runtime
const SHIPPED_DIR = path.join(__dirname, '..', 'models');
const REMOTE_DIR = path.join(DATA_DIR, 'models-remote');
const MODEL_VERSION = 1;
const PARAMS = {
  trees: 400, lr: 0.06, maxDepth: 5, minChild: 40, lambda: 1.0,
  bins: 32, rowSubsample: 0.85, colSubsample: 0.85, earlyStopRounds: 30, valFrac: 0.15,
};

const modelCache = new Map(); // mode -> model | null (null = checked, doesn't exist)
const training = new Set();

function modelPath(mode) { return path.join(DATA_DIR, `gbdt-rank-${mode}.json`); }

// ---------- feature extraction (same order as SHEET_STATS) ----------
function featuresOf(stats) {
  const { SHEET_STATS } = require('./aggregate');
  const x = new Float64Array(SHEET_STATS.length);
  SHEET_STATS.forEach(([, get], i) => { x[i] = get(stats) || 0; });
  return x;
}

// ---------- training ----------
function quantileEdges(values, maxBins) {
  const v = Float64Array.from(values).sort();
  const edges = [];
  for (let b = 1; b < maxBins; b++) {
    const e = v[Math.min(v.length - 1, Math.floor((b * v.length) / maxBins))];
    if (!edges.length || e > edges[edges.length - 1]) edges.push(e);
  }
  return edges; // bin k: x <= edges[k]; last bin = the remainder
}

function upperBound(edges, x) {
  let lo = 0, hi = edges.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (x <= edges[mid]) hi = mid; else lo = mid + 1; }
  return lo; // 0..edges.length
}

/** One tree on (a subset of) the residuals; returns flat nodes {f, bin, thr, l, r, v}. */
function buildTree(cols, edgesPerF, grad, sampleIdx, featIdx, p) {
  const nodes = [];
  const build = (samples, depth) => {
    const id = nodes.length;
    nodes.push(null);
    let S = 0;
    for (let i = 0; i < samples.length; i++) S += grad[samples[i]];
    const n = samples.length;
    const asLeaf = () => { nodes[id] = { f: -1, v: (p.lr * S) / (n + p.lambda) }; return id; };
    if (depth >= p.maxDepth || n < 2 * p.minChild) return asLeaf();

    const parentScore = (S * S) / (n + p.lambda);
    let best = null;
    for (const f of featIdx) {
      const col = cols[f];
      const nb = edgesPerF[f].length + 1;
      if (nb < 2) continue;
      const cnt = new Float64Array(nb), sum = new Float64Array(nb);
      for (let i = 0; i < n; i++) { const b = col[samples[i]]; cnt[b]++; sum[b] += grad[samples[i]]; }
      let nL = 0, sL = 0;
      for (let b = 0; b < nb - 1; b++) {
        nL += cnt[b]; sL += sum[b];
        const nR = n - nL, sR = S - sL;
        if (nL < p.minChild || nR < p.minChild) continue;
        const gain = (sL * sL) / (nL + p.lambda) + (sR * sR) / (nR + p.lambda) - parentScore;
        if (gain > 1e-6 && (!best || gain > best.gain)) best = { gain, f, bin: b };
      }
    }
    if (!best) return asLeaf();

    const left = [], right = [];
    const col = cols[best.f];
    for (let i = 0; i < n; i++) (col[samples[i]] <= best.bin ? left : right).push(samples[i]);
    nodes[id] = { f: best.f, bin: best.bin, thr: edgesPerF[best.f][best.bin], l: -1, r: -1 };
    nodes[id].l = build(left, depth + 1);
    nodes[id].r = build(right, depth + 1);
    return id;
  };
  build(sampleIdx, 0);
  return nodes;
}

function predictTreeBinned(nodes, cols, row) {
  let n = nodes[0];
  while (n.f >= 0) n = nodes[cols[n.f][row] <= n.bin ? n.l : n.r];
  return n.v;
}

function predictTreeRaw(nodes, x) {
  let n = nodes[0];
  while (n.f >= 0) n = nodes[x[n.f] <= n.thr ? n.l : n.r];
  return n.v;
}

// deterministic PRNG (mulberry32) — reproducible training
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Asynchronous training (yields between trees so the API stays responsive). */
async function trainMode(mode) {
  const { getBenchStats, SHEET_STATS, BUCKET_TIERS } = require('./aggregate');
  // rows with an unknown bucket carry no usable label — drop them instead of
  // silently defaulting to some middle tier
  let rows = getBenchStats(mode).filter((r) => BUCKET_TIERS[r.bucket] != null);
  if (rows.length < 2000) return null;
  // training balance: the corpus keeps EVERY game (percentiles want the full
  // population), but a bucket with 10× more rows than the rest would dominate the
  // loss — deterministically subsample each bucket to at most MAX_BUCKET_ROWS
  const MAX_BUCKET_ROWS = 10000;
  {
    const byBucket = new Map();
    for (const r of rows) (byBucket.get(r.bucket) || byBucket.set(r.bucket, []).get(r.bucket)).push(r);
    const rnd = rng(4242 + Number(mode));
    const kept = [];
    for (const arr of byBucket.values()) {
      if (arr.length <= MAX_BUCKET_ROWS) { kept.push(...arr); continue; }
      const idx = arr.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, MAX_BUCKET_ROWS);
      for (const i of idx) kept.push(arr[i]);
      console.log(`[gbdt] mode ${mode}: bucket subsampled ${arr.length} -> ${MAX_BUCKET_ROWS} rows for training balance`);
    }
    rows = kept;
  }

  const m = SHEET_STATS.length;
  const X = rows.map((r) => featuresOf(r.stats));
  const y = Float64Array.from(rows, (r) => BUCKET_TIERS[r.bucket]);

  // split by MATCH (players of the same match share context → must not leak into val)
  const midHash = (s) => { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const isVal = rows.map((r) => (midHash(r.mid) % 1000) / 1000 < PARAMS.valFrac);
  const trainIdx = [], valIdx0 = [];
  isVal.forEach((v, i) => (v ? valIdx0 : trainIdx).push(i));
  // purge val rows whose PLAYER also appears in train — ~half the corpus rows come
  // from players seen in more than one match, and identity leakage across the split
  // makes val MAE optimistic
  const trainPlayers = new Set(trainIdx.map((i) => rows[i].playerKey).filter(Boolean));
  let valIdx = valIdx0.filter((i) => !rows[i].playerKey || !trainPlayers.has(rows[i].playerKey));
  // with heavy player overlap the purge can empty the val set — an empty val makes
  // early stopping meaningless and reports a fantasy "valMAE 0.00"
  if (valIdx.length < 100) {
    console.log(`[gbdt] mode ${mode}: player purge left only ${valIdx.length} val rows — falling back to the unpurged split`);
    valIdx = valIdx0;
  }

  // binning on the train split
  const edgesPerF = [];
  const cols = [];
  for (let f = 0; f < m; f++) {
    edgesPerF[f] = quantileEdges(trainIdx.map((i) => X[i][f]), PARAMS.bins);
    const col = new Uint8Array(rows.length);
    for (let i = 0; i < rows.length; i++) col[i] = upperBound(edgesPerF[f], X[i][f]);
    cols[f] = col;
  }

  const base = trainIdx.reduce((a, i) => a + y[i], 0) / trainIdx.length;
  const pred = new Float64Array(rows.length).fill(base);
  const grad = new Float64Array(rows.length);
  const rand = rng(1337 + Number(mode));
  const trees = [];
  let bestValMse = Infinity, bestIter = -1;

  for (let t = 0; t < PARAMS.trees; t++) {
    for (const i of trainIdx) grad[i] = y[i] - pred[i];
    const sample = trainIdx.filter(() => rand() < PARAMS.rowSubsample);
    const feats = [...Array(m).keys()].filter(() => rand() < PARAMS.colSubsample);
    if (!feats.length) feats.push(Math.floor(rand() * m));
    const nodes = buildTree(cols, edgesPerF, grad, sample, feats, PARAMS);
    trees.push(nodes);
    for (let i = 0; i < rows.length; i++) pred[i] += predictTreeBinned(nodes, cols, i);

    let mse = 0;
    for (const i of valIdx) mse += (y[i] - pred[i]) ** 2;
    mse /= Math.max(1, valIdx.length);
    if (mse < bestValMse - 1e-4) { bestValMse = mse; bestIter = t; }
    if (t - bestIter >= PARAMS.earlyStopRounds) break;
    if (t % 10 === 0) await new Promise((r) => setImmediate(r));
  }
  trees.length = bestIter + 1;

  // final metrics on the val set (with the truncated ensemble)
  let mae = 0, baseMae = 0;
  for (const i of valIdx) {
    let pv = base;
    for (const tr of trees) pv += predictTreeBinned(tr, cols, i);
    mae += Math.abs(y[i] - pv);
    baseMae += Math.abs(y[i] - base); // constant predictor (train mean) — the honesty floor
  }
  mae /= Math.max(1, valIdx.length);
  baseMae /= Math.max(1, valIdx.length);

  const model = {
    version: MODEL_VERSION, mode: Number(mode), nRows: rows.length,
    trainedAt: new Date().toISOString(),
    features: SHEET_STATS.map(([k]) => k),
    base, trees, valMAE: Math.round(mae * 100) / 100, baseMAE: Math.round(baseMae * 100) / 100, valN: valIdx.length,
  };
  fs.writeFileSync(modelPath(mode), JSON.stringify(model));
  modelCache.set(Number(mode), model);
  console.log(`[gbdt] mode ${mode}: trained ${trees.length} trees on ${trainIdx.length} rows — val MAE ${model.valMAE} vs baseline ${model.baseMAE} tiers (n=${valIdx.length}, player-clean val)`);
  return model;
}

function loadModel(mode) {
  const key = Number(mode);
  if (modelCache.has(key)) return modelCache.get(key);
  // newest valid model wins: locally trained (own corpus) vs auto-downloaded vs shipped
  const candidates = [
    [modelPath(key), 'local'],
    [path.join(REMOTE_DIR, `gbdt-rank-${key}.json`), 'remote'],
    [path.join(SHIPPED_DIR, `gbdt-rank-${key}.json`), 'shipped'],
  ];
  let model = null;
  const featureKeys = require('./aggregate').SHEET_STATS.map(([k]) => k);
  for (const [p, source] of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (raw.version !== MODEL_VERSION) continue;
      // a model trained against a different feature list/order would silently read
      // the wrong stat at every tree split — reject instead
      if (!Array.isArray(raw.features) || raw.features.length !== featureKeys.length
        || raw.features.some((k, i) => k !== featureKeys[i])) continue;
      if (!model || Date.parse(raw.trainedAt || 0) > Date.parse(model.trainedAt || 0)) {
        model = raw;
        model.source = source;
      }
    } catch { /* absent or invalid */ }
  }
  modelCache.set(key, model);
  return model;
}

// ---------- published-model auto-update (users without a benchmark corpus) ----------
const MODELS_RAW_BASE = 'https://raw.githubusercontent.com/rorogulj/rl-stat-tracker/main/server/models';

/**
 * Fetch the published model manifest from GitHub and download any model newer
 * than what we currently use. Silent on any failure (offline, private repo).
 */
async function syncRemoteModels() {
  let manifest;
  try {
    const r = await fetch(`${MODELS_RAW_BASE}/manifest.json`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return;
    manifest = await r.json();
  } catch { return; }
  for (const mode of [1, 2, 3]) {
    const remote = manifest?.models?.[mode];
    if (!remote?.trainedAt) continue;
    const current = loadModel(mode);
    if (current && Date.parse(current.trainedAt || 0) >= Date.parse(remote.trainedAt)) continue;
    try {
      const r = await fetch(`${MODELS_RAW_BASE}/gbdt-rank-${mode}.json`, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) continue;
      const body = await r.text();
      const parsed = JSON.parse(body); // validate before writing
      if (parsed.version !== MODEL_VERSION) continue;
      fs.mkdirSync(REMOTE_DIR, { recursive: true });
      fs.writeFileSync(path.join(REMOTE_DIR, `gbdt-rank-${mode}.json`), body);
      modelCache.delete(Number(mode));
      calCache.delete(Number(mode));
      console.log(`[gbdt] mode ${mode}: downloaded published model (trained ${parsed.trainedAt}, val MAE ${parsed.valMAE})`);
    } catch { /* keep what we have */ }
  }
}

/** Train/retrain all modes missing a model or whose corpus has grown >5%. */
async function ensureModels() {
  const { getBenchStats } = require('./aggregate');
  for (const mode of [1, 2, 3]) {
    if (training.has(mode)) continue;
    try {
      const rows = getBenchStats(mode);
      if (rows.length < 2000) continue;
      const existing = loadModel(mode);
      const stale = !existing || Math.abs(existing.nRows - rows.length) / rows.length > 0.05
        || existing.features.length !== require('./aggregate').SHEET_STATS.length;
      if (!stale) continue;
      training.add(mode);
      console.log(`[gbdt] mode ${mode}: training on ${rows.length} rows…`);
      await trainMode(mode);
    } catch (e) {
      console.log(`[gbdt] mode ${mode} training failed:`, e.message);
    } finally {
      training.delete(mode);
    }
  }
}

/** Raw tier prediction for ONE game (without calibration). */
function predictGame(stats, mode) {
  const model = loadModel(mode);
  if (!model) return null;
  const x = featuresOf(stats);
  let p = model.base;
  for (const tr of model.trees) p += predictTreeRaw(tr, x);
  return Math.max(0, Math.min(22, p));
}

// ---------- calibration to tracker.gg (10-min cache) ----------
const calCache = new Map(); // mode -> { t, a, b, n }
function calibration(mode) {
  const key = Number(mode);
  const hit = calCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit;
  let a = 0, b = 1, n = 0;
  try {
    const { stmts } = require('./db');
    const trn = require('./trn');
    const agg = require('./aggregate');
    const byPlayer = new Map();
    for (const r of stmts.allPlayerRows.all()) {
      if (r.team_size !== key || r.is_bot) continue;
      (byPlayer.get(r.player_key) || byPlayer.set(r.player_key, []).get(r.player_key)).push(r);
    }
    const me = agg.detectMe();
    const pairs = [];
    for (const [pk, rows] of byPlayer) {
      if (rows.length < 2) continue;
      const real = pk === me ? trn.cachedRankForMode(key) : trn.cachedPlayerRank(pk, key);
      if (!real || real.tier == null || real.tier <= 0) continue;
      const preds = rows.map((r) => { try { return predictGame(JSON.parse(r.stats), key); } catch { return null; } })
        .filter((v) => v != null);
      if (preds.length < 2) continue;
      pairs.push([preds.reduce((x, v) => x + v, 0) / preds.length, real.tier]);
    }
    n = pairs.length;
    if (n >= 8) {
      const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
      const my = pairs.reduce((s, p) => s + p[1], 0) / n;
      let cov = 0, varx = 0;
      for (const [px, py] of pairs) { cov += (px - mx) * (py - my); varx += (px - mx) ** 2; }
      // a slope needs real spread in the predictions: pairs clustered within half a
      // tier pass a sum-based epsilon and produce absurd extrapolating slopes —
      // require variance (varx/n) of at least (0.2 tier)², else offset-only
      if (varx / n >= 0.04) {
        b = Math.max(0.6, Math.min(1.6, cov / varx));
        a = my - b * mx;
      } else {
        b = 1;
        a = my - mx;
      }
    } else if (n >= 3) {
      a = pairs.reduce((s, p) => s + (p[1] - p[0]), 0) / n; // offset only
      b = 1;
    }
  } catch { /* no calibration */ }
  const out = { t: Date.now(), a, b, n };
  calCache.set(key, out);
  return out;
}

/**
 * Calibrated tier estimate for a set of games: mean(per-game prediction) → linear
 * correction onto the tracker.gg scale. Returns null if no model exists for the mode.
 */
function estimateTier(games, mode) {
  if (!mode || !games || !games.length) return null;
  const model = loadModel(mode);
  if (!model) return null;
  const preds = games.map((g) => predictGame(g.s, mode)).filter((v) => v != null);
  if (!preds.length) return null;
  const raw = preds.reduce((a, v) => a + v, 0) / preds.length;
  const cal = calibration(mode);
  const t = cal.a + cal.b * raw;
  return Math.round(Math.max(0, Math.min(22, t)) * 10) / 10;
}

/** Status for /api/server. */
function info() {
  const out = {};
  for (const mode of [1, 2, 3]) {
    const m = loadModel(mode);
    const cal = m ? calibration(mode) : null;
    out[mode] = m ? {
      trees: m.trees.length, nRows: m.nRows, valMAE: m.valMAE, baseMAE: m.baseMAE ?? null,
      trainedAt: m.trainedAt, source: m.source, calibrated: cal ? cal.n : 0, training: training.has(mode),
    } : { training: training.has(mode) };
  }
  return out;
}

module.exports = { ensureModels, syncRemoteModels, estimateTier, predictGame, calibration, info };
