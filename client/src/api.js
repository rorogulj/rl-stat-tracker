// demo mode: the public site serves anonymized JSON snapshots instead of the API
export const isDemo = () => { try { return localStorage.getItem('rl_demo') === '1'; } catch { return false; } };
export const enterDemo = () => { try { localStorage.setItem('rl_demo', '1'); } catch { /* ignore */ } window.location.href = '/'; };
export const exitDemo = () => { try { localStorage.removeItem('rl_demo'); } catch { /* ignore */ } window.location.href = '/'; };
const demoSlug = (url) => '/demo/' + url.replace(/^\/api\//, '').replace(/[/?&=]/g, '_') + '.json';

async function j(url, opts) {
  if (isDemo()) {
    if (opts?.method && opts.method !== 'GET') return { demo: true }; // writes are no-ops
    const r = await fetch(demoSlug(url));
    if (!r.ok) throw new Error('not in demo dataset');
    return r.json();
  }
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
}

const q = (params) => {
  const s = Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? '?' + s : '';
};

export const api = {
  status: () => j('/api/status'),
  server: () => j('/api/server'),
  rankLadder: (mode) => j('/api/rank-ladder' + q({ mode })),
  players: () => j('/api/players'),
  matches: (player, mode) => j('/api/matches' + q({ player, mode })),
  match: (id) => j('/api/matches/' + encodeURIComponent(id)),
  timeline: (id) => j('/api/matches/' + encodeURIComponent(id) + '/timeline'),
  matchRanks: (id, refresh) => j('/api/matches/' + encodeURIComponent(id) + '/ranks' + (refresh ? '?refresh=1' : '')),
  profile: (player, mode) => j('/api/profile' + q({ player, mode })),
  opponents: (player, mode) => j('/api/opponents' + q({ player, mode })),
  settings: () => j('/api/settings'),
  rank: (refresh) => j('/api/rank' + (refresh ? '?refresh=1' : '')),
  rankHistory: (mode) => j('/api/rank-history' + q({ mode })),
  benchmark: (mode) => j('/api/benchmark' + q({ mode })),
  saveSettings: (body) => j('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  favorites: () => j('/api/favorites'),
  toggleFavorite: (key, name) => j('/api/favorites/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, name }) }),
  triggerImport: () => j('/api/import', { method: 'POST' }),
  update: (force) => j('/api/update' + (force ? '?force=1' : '')),
  runUpdate: () => j('/api/update/run', { method: 'POST' }),
};

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDur(sec) {
  if (sec == null) return '—';
  // round the TOTAL first — rounding the remainder alone produced "4:60"
  const total = Math.round(sec);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
