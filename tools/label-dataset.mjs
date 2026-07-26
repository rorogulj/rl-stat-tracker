// Label the external dataset's players with ranks-at-match-time from ballchasing.
// Strategy: the dataset has ~2.2k distinct players across 119k replays, so a small
// greedy covering set of replays (each API response lists every participant's rank)
// yields a player→tier map for nearly all of them. Resumable; writes
// kaggle-replays/player-tiers.json. Pause the corpus downloader first (shared key).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'kaggle-replays');
const KEY = fs.readFileSync(path.join(ROOT, 'server', 'data', 'ballchasing.key'), 'utf8').trim();
const OUT = path.join(DIR, 'player-tiers.json');
const MAX_CALLS = Number(process.argv[2] || 1500);

const scan = JSON.parse(fs.readFileSync(path.join(DIR, 'scan.json'), 'utf8'));

// ballchasing tier id -> our 0-22 scale
const TIER_ID = { 'unranked': 0, 'supersonic-legend': 22 };
for (const [i, base] of [['bronze', 0], ['silver', 3], ['gold', 6], ['platinum', 9], ['diamond', 12], ['champion', 15], ['grand-champion', 18]].map((x, i) => [i, x])) {
  const [name, off] = base;
  for (let d = 1; d <= 3; d++) TIER_ID[`${name}-${d}`] = off + d;
}

// resume state: playerId -> [tier observations]; fetched replay ids
const state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { obs: {}, fetched: [] };
const fetched = new Set(state.fetched);
const covered = new Set(Object.keys(state.obs));

// only ranked replays carry ranks on ballchasing — private scrims return nothing
const isRanked = (r) => /ranked (duel|doubles|standard)/i.test(r.rn || '');
// greedy cover: repeatedly take the replay with the most uncovered players
const entries = Object.entries(scan).filter(([, r]) => isRanked(r));
console.log(`${entries.length} ranked replays in scope`);
function pickNext() {
  let best = null, bestGain = 0;
  for (const [id, r] of entries) {
    if (fetched.has(id)) continue;
    const gain = r.players.filter((p) => p.id && p.id !== '0' && !covered.has(p.id)).length;
    if (gain > bestGain) { best = id; bestGain = gain; }
  }
  return bestGain > 0 ? best : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0, unknownTiers = new Set();
console.log(`starting: ${covered.size} players already covered, budget ${MAX_CALLS} calls`);

while (calls < MAX_CALLS) {
  const id = pickNext();
  if (!id) { console.log('full cover reached'); break; }
  const r = await fetch(`https://ballchasing.com/api/replays/${id}`, { headers: { Authorization: KEY } });
  calls++;
  if (r.status === 429) { console.log('rate limited — sleeping 60 s'); await sleep(60000); fetched.delete(id); calls--; continue; }
  fetched.add(id);
  if (!r.ok) { await sleep(600); continue; }
  const j = await r.json();
  const bcPlayers = [...(j.blue?.players || []), ...(j.orange?.players || [])];
  // match ballchasing players to our header roster BY NAME within this same match
  const roster = scan[id].players;
  for (const bp of bcPlayers) {
    const tierId = bp.rank?.id;
    if (!tierId) continue;
    if (!(tierId in TIER_ID)) { unknownTiers.add(tierId); continue; }
    const mine = roster.find((p) => p.name === bp.name);
    if (!mine || !mine.id || mine.id === '0') continue;
    (state.obs[mine.id] = state.obs[mine.id] || []).push(TIER_ID[tierId]);
    covered.add(mine.id);
  }
  if (calls % 25 === 0) {
    state.fetched = [...fetched];
    fs.writeFileSync(OUT, JSON.stringify(state));
    console.log(`${calls} calls · covered ${covered.size} players`);
  }
  await sleep(600); // ~1.6/s, under the 2/s limit
}

state.fetched = [...fetched];
fs.writeFileSync(OUT, JSON.stringify(state));
if (unknownTiers.size) console.log('unknown tier ids:', [...unknownTiers].join(', '));

// coverage report: how many RANKED replays can be labeled (>= half of players known)?
let labelable = 0;
const hist = {};
for (const [, r] of entries) {
  const known = r.players.map((p) => state.obs[p.id]).filter(Boolean);
  if (known.length >= Math.max(1, Math.ceil(r.players.length / 2))) {
    labelable++;
    const avg = known.map((o) => o.reduce((a, b) => a + b, 0) / o.length).reduce((a, b) => a + b, 0) / known.length;
    const b = avg >= 21.5 ? 'ssl' : avg >= 18.5 ? 'grand-champion' : avg >= 15.5 ? 'champion' : avg >= 12.5 ? 'diamond' : 'lower';
    hist[b] = (hist[b] || 0) + 1;
  }
}
console.log(`covered players: ${covered.size} · labelable replays: ${labelable}/${entries.length}`);
console.log('rough bucket histogram:', hist);
