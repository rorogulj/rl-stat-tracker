// Build the public demo dataset: crawl the LOCAL API, anonymize every player
// except "me" (I become DEMO_PLAYER), and write static JSON snapshots into
// demo-data/. Other players' names and keys must never appear in the output —
// replacement is done by walking the whole JSON tree AND by substring, and the
// result is verified at the end (the script fails loudly on any leak).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:7845/api';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo-data');

const FAKE_POOL = [
  'BoostGoblin', 'PixelPirate', 'WaveDashWilly', 'CeilingShotCarl', 'MustyMike',
  'DoubleCommitDan', 'WhiffMaster', 'RotationRita', 'AirDribbleAndy', 'DemoDorothy',
  'KickoffKid', 'BackboardBecky', 'FlipResetFred', 'PogChampPetar', 'SpeedFlipSara',
  'GoalpostGary', 'OwnGoalOtto', 'SaveLordSven', 'ChatDisabled', 'CalculatedCarl',
  'NiceShotNina', 'What_A_Save', 'BumpMerchant', 'TouchGrassTom', 'ZeroBoostZoe',
  'PadThiefPaul', 'ShadowDefender', 'CarryPotato', 'TiltedTeo', 'LagSpikeLuka',
  'BronzeInDisguise', 'SmurfHunter', 'PanicClearPete', 'CornerBoostKarl', 'HalfFlipHana',
  'FakeChallengeF', 'CutBackKiki', 'PinchPointPia', 'DunkMasterDino', 'RampRiderRoko2',
];

const fetchJson = async (p) => {
  const r = await fetch(`${API}${p}`);
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
};
const slug = (p) => p.replace(/^\//, '').replace(/[/?&=]/g, '_') + '.json';

// ---------- 1. collect identities ----------
const status = await fetchJson('/status');
const players = await fetchJson('/players');
const myKey = players.me;

const nameMap = new Map();  // real name -> fake
const keyMap = new Map();   // real key  -> fake
let fi = 0;
const fakeFor = () => FAKE_POOL[fi++ % FAKE_POOL.length] + (fi > FAKE_POOL.length ? `_${Math.floor(fi / FAKE_POOL.length)}` : '');

function registerPlayer(key, name) {
  if (key && !keyMap.has(key)) keyMap.set(key, key === myKey ? 'demo-player' : `demo-${keyMap.size + 1}`);
  if (name && !nameMap.has(name)) nameMap.set(name, key === myKey || name === players.players.find((p) => p.player_key === myKey)?.name ? 'DEMO_PLAYER' : fakeFor());
}
registerPlayer(myKey, null);
for (const p of players.players) registerPlayer(p.player_key, p.name);

// ---------- 2. anonymizer: whole-tree walk + substring pass ----------
const namesByLen = () => [...nameMap.keys()].sort((a, b) => b.length - a.length);
function scrubString(s) {
  if (keyMap.has(s)) return keyMap.get(s);
  if (nameMap.has(s)) return nameMap.get(s);
  let out = s;
  for (const real of namesByLen()) {
    if (out.includes(real)) out = out.split(real).join(nameMap.get(real));
  }
  for (const [rk, fk] of keyMap) if (out.includes(rk)) out = out.split(rk).join(fk);
  return out;
}
function scrub(node) {
  if (typeof node === 'string') return scrubString(node);
  if (Array.isArray(node)) return node.map(scrub);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const nk = scrubString(k);
      if (nk === 'epicId' || nk === 'uid' || nk === 'platformUserId' || nk === 'platformUserHandle') { out[nk] = null; continue; }
      out[nk] = scrub(v);
    }
    return out;
  }
  return node;
}

// ---------- 3. crawl ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let files = 0, bytes = 0;
async function snap(p) {
  try {
    const data = scrub(await fetchJson(p));
    const body = JSON.stringify(data);
    fs.writeFileSync(path.join(OUT, slug(p)), body);
    files++; bytes += body.length;
    return data;
  } catch (e) {
    console.log(`skip ${p}: ${e.message}`);
    return null;
  }
}

await snap('/status');
await snap('/players');
await snap('/rank');
await snap('/favorites');
fs.writeFileSync(path.join(OUT, slug('/update')), JSON.stringify({ current: 'demo', latest: null, available: false, dev: false }));
fs.writeFileSync(path.join(OUT, slug('/settings')), JSON.stringify({ my_accounts: ['demo-player'] }));

const DETAILS_PER_MODE = 6, TIMELINES_PER_MODE = 2;
const detailIds = [];
for (const mode of ['', '1', '2', '3']) {
  const q = mode ? `?mode=${mode}` : '';
  const matches = await snap(`/matches${q}`);
  await snap(`/profile${q}`);
  await snap(`/opponents${q}`);
  await snap(`/rank-history${q}`);
  if (mode) { await snap(`/benchmark${q}`); await snap(`/rank-ladder${q}`); }
  // pick recent matches of this mode for full detail (raw ids — scrub only outputs)
  const raw = await fetchJson(`/matches${q}`);
  raw.matches.slice(0, DETAILS_PER_MODE).forEach((m, i) => detailIds.push([m.id, i < TIMELINES_PER_MODE]));
}
for (const [id, withTl] of [...new Map(detailIds.map(([id, t]) => [id, t]))]) {
  await snap(`/matches/${encodeURIComponent(id)}`);
  await snap(`/matches/${encodeURIComponent(id)}/ranks`);
  if (withTl) await snap(`/matches/${encodeURIComponent(id)}/timeline`);
}

// ---------- 4. leak check ----------
const realNames = [...nameMap.keys()].filter((n) => nameMap.get(n) !== n);
const realKeys = [...keyMap.keys()];
let leaks = 0;
for (const f of fs.readdirSync(OUT)) {
  const body = fs.readFileSync(path.join(OUT, f), 'utf8');
  for (const n of realNames) if (body.includes(JSON.stringify(n).slice(1, -1))) { console.error(`LEAK: name "${n}" in ${f}`); leaks++; }
  for (const k of realKeys) if (body.includes(k)) { console.error(`LEAK: key "${k}" in ${f}`); leaks++; }
}
if (leaks) { console.error(`${leaks} leaks — demo NOT safe, aborting`); process.exit(1); }
console.log(`OK: ${files} files, ${(bytes / 1048576).toFixed(1)} MB, ${nameMap.size} players anonymized, 0 leaks`);
