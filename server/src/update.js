'use strict';
/**
 * App version + self-update.
 *
 * check(): compares the local package.json version against the one on GitHub main
 * (cached 6 h). runUpdate(): re-runs install.ps1 detached — the script waits for
 * this process to exit, replaces the app in place and restarts the server; the
 * browser reconnects on its own (Boot gate polling). Dev checkouts (.git present)
 * never self-update — that would clobber the working copy; use git pull.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const RAW_PKG = 'https://raw.githubusercontent.com/rorogulj/rl-stat-tracker/main/package.json';

const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
})();

const isDevCheckout = fs.existsSync(path.join(ROOT, '.git'));

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

let cache = null; // { t, latest }

async function check(force) {
  // opt-out: set RL_NO_UPDATE_CHECK=1 and the server never contacts GitHub
  if (process.env.RL_NO_UPDATE_CHECK) {
    return { current: VERSION, latest: null, available: false, dev: isDevCheckout, disabled: true };
  }
  if (!force && cache && Date.now() - cache.t < 6 * 3600 * 1000) return result();
  let latest = null;
  try {
    const r = await fetch(RAW_PKG, { signal: AbortSignal.timeout(15000) });
    if (r.ok) latest = (await r.json()).version || null;
  } catch { /* offline or repo unreachable */ }
  cache = { t: Date.now(), latest };
  return result();
}

function result() {
  const latest = cache?.latest || null;
  return {
    current: VERSION,
    latest,
    available: !!latest && cmpVer(latest, VERSION) > 0,
    dev: isDevCheckout,
    checkedAt: cache?.t || null,
  };
}

function runUpdate() {
  if (isDevCheckout) throw new Error('dev checkout — update with git pull');
  // run from a temp copy: the original gets replaced mid-update
  const tmp = path.join(os.tmpdir(), 'rl-tracker-update.ps1');
  fs.copyFileSync(path.join(ROOT, 'install.ps1'), tmp);
  spawn('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tmp, '-FromUpdate'],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  console.log('[update] updater launched — shutting down for the update');
  setTimeout(() => process.exit(0), 600);
}

module.exports = { VERSION, check, runUpdate, isDevCheckout };
