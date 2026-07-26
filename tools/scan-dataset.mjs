// Fast header-only scan of the external dataset: who plays in each replay?
// rrrocket -m -j <dir> streams {"file", "replay"} JSON lines (header only, no
// network parse — milliseconds per file). Output: kaggle-replays/scan.json
// (per-file players/date/mode) + players.json (distinct players by appearances).
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RRROCKET = path.join(ROOT, 'tools', 'rrrocket.exe');
const DIR = path.join(ROOT, 'kaggle-replays');

const out = {};
const playerCount = new Map();
let done = 0;
const t0 = Date.now();

async function scanMode(mode) {
  const d = path.join(DIR, mode);
  if (!fs.existsSync(d)) return;
  await new Promise((resolve) => {
    const p = spawn(RRROCKET, ['-m', '-j', d]);
    const rl = readline.createInterface({ input: p.stdout });
    rl.on('line', (line) => {
      try {
        const { file, replay } = JSON.parse(line);
        const props = replay.properties;
        const gv = (k) => { const v = props[k]; return v && (v.value ?? v); };
        const stats = gv('PlayerStats') || [];
        const players = stats.filter((s) => !s.bBot).map((s) => ({
          id: String(s.OnlineID || ''), name: s.Name, team: s.Team,
        }));
        out[path.basename(file, '.replay')] = {
          mode, date: gv('Date'), players,
          rn: String(gv('ReplayName') || ''), mt: String(gv('MatchType') || ''),
        };
        for (const pl of players) {
          if (!pl.id || pl.id === '0') continue;
          const e = playerCount.get(pl.id) || { name: pl.name, n: 0 };
          e.n++; playerCount.set(pl.id, e);
        }
        done++;
        if (done % 5000 === 0) {
          console.log(`${done} scanned · ${Math.round(done / ((Date.now() - t0) / 60000))}/min · distinct players: ${playerCount.size}`);
        }
      } catch { /* corrupt line */ }
    });
    p.on('close', resolve);
    p.on('error', resolve);
  });
}

await Promise.all(['1v1', '2v2', '3v3'].map(scanMode));

fs.writeFileSync(path.join(DIR, 'scan.json'), JSON.stringify(out));
const players = [...playerCount.entries()].sort((a, b) => b[1].n - a[1].n);
fs.writeFileSync(path.join(DIR, 'players.json'), JSON.stringify(players));
console.log(`\nscanned ${Object.keys(out).length} replays · ${players.length} distinct players`);
console.log('top 10 by appearances:', players.slice(0, 10).map(([, e]) => `${e.name} (${e.n})`).join(' · '));
console.log(`players with >= 20 appearances: ${players.filter(([, e]) => e.n >= 20).length}`);
console.log(`replay coverage by top-500 players: ${(() => {
  const top = new Set(players.slice(0, 500).map(([id]) => id));
  let cov = 0;
  for (const r of Object.values(out)) if (r.players.some((pl) => top.has(pl.id))) cov++;
  return `${cov}/${Object.keys(out).length}`;
})()}`);
