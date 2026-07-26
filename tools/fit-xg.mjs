// One-off: refit Platt calibration coefficients for xG.
// Pulls every stored shot (v16 pipeline: deduped, rebound pre-calibration), inverts
// the OLD calibration (a=0.422, b=0.367 ??? monotonic, exactly invertible inside the
// clamp) to recover raw values, then fits logistic regression goal ~ logit(raw).
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.RL_DATA_DIR ? process.env.RL_DATA_DIR + '/stats.db' : new URL('../server/data/stats.db', import.meta.url).pathname.slice(1), { readOnly: true });
const rows = db.prepare(`SELECT ps.stats FROM player_stats ps JOIN matches m ON m.id = ps.match_id WHERE m.benchmark = 0`).all();

const A_OLD = 0.422, B_OLD = 0.367;
const logit = (p) => Math.log(p / (1 - p));
const sig = (z) => 1 / (1 + Math.exp(-z));
// invert: cal = sig(a*logit(raw)+b)  =>  raw = sig((logit(cal)-b)/a)
const invert = (cal) => sig((logit(Math.min(0.999, Math.max(0.001, cal))) - B_OLD) / A_OLD);

const X = [], Y = [];
let synthSkipped = 0;
for (const r of rows) {
  let s;
  try { s = JSON.parse(r.stats); } catch { continue; }
  for (const sh of s.xg?.shots || []) {
    if (!sh.speed) { synthSkipped++; continue; } // synth records (speed 0) are always goals ??? biased
    const raw = sh.xgRaw != null ? sh.xgRaw : invert(sh.xg); // v17 stores raw directly
    X.push(logit(Math.min(0.995, Math.max(0.005, raw))));
    Y.push(sh.goal ? 1 : 0);
  }
}
console.log(`shots: ${X.length} (synth skipped: ${synthSkipped}), goals: ${Y.reduce((a, b) => a + b, 0)}`);

// logistic regression p = sig(a*x + b) via Newton-Raphson
let a = 1, b = 0;
for (let it = 0; it < 50; it++) {
  let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
  for (let i = 0; i < X.length; i++) {
    const p = sig(a * X[i] + b);
    const e = p - Y[i], w = p * (1 - p);
    g0 += e * X[i]; g1 += e;
    h00 += w * X[i] * X[i]; h01 += w * X[i]; h11 += w;
  }
  const det = h00 * h11 - h01 * h01;
  if (Math.abs(det) < 1e-12) break;
  const da = (g0 * h11 - g1 * h01) / det;
  const dbb = (g1 * h00 - g0 * h01) / det;
  a -= da; b -= dbb;
  if (Math.abs(da) < 1e-9 && Math.abs(dbb) < 1e-9) break;
}
console.log(`fitted: a=${a.toFixed(4)} b=${b.toFixed(4)}`);

// calibration report per decile of raw
const buckets = Array.from({ length: 10 }, () => ({ n: 0, g: 0, p: 0 }));
for (let i = 0; i < X.length; i++) {
  const raw = sig(X[i]);
  const k = Math.min(9, Math.floor(raw * 10));
  buckets[k].n++; buckets[k].g += Y[i]; buckets[k].p += sig(a * X[i] + b);
}
buckets.forEach((bk, k) => {
  if (bk.n) console.log(`raw ${(k / 10).toFixed(1)}-${((k + 1) / 10).toFixed(1)}: n=${bk.n} actual=${(bk.g / bk.n).toFixed(3)} predicted=${(bk.p / bk.n).toFixed(3)}`);
});
const totG = Y.reduce((x, y) => x + y, 0);
let totP = 0; for (let i = 0; i < X.length; i++) totP += sig(a * X[i] + b);
console.log(`total: goals=${totG} predicted xG sum=${totP.toFixed(1)}`);
