import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/** Settings: managing "my accounts" (multi-account stats). */
export default function SettingsModal({ onClose, onSaved }) {
  const [players, setPlayers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [autoMe, setAutoMe] = useState(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(null); // null | 'uploading' | 'waiting' | 'error'
  const fileRef = useRef(null);

  const doRestore = async (file) => {
    if (!file) return;
    if (!window.confirm(`Replace the current database with "${file.name}"?\nThe current one is kept as stats.db.bak. The server will restart.`)) return;
    setRestoring('uploading');
    try {
      const r = await fetch('/api/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      if (!r.ok) throw new Error((await r.json()).error || 'restore failed');
      setRestoring('waiting');
      // the server restarts — wait for it to come back, then reload
      for (let i = 0; i < 40; i++) {
        await new Promise((ok) => setTimeout(ok, 1000));
        try { await api.status(); window.location.reload(); return; } catch { /* still starting up */ }
      }
      setRestoring('error');
    } catch {
      setRestoring('error');
    }
  };

  // replay folder picker
  const [rd, setRd] = useState(null);           // { current, source, exists, replays, candidates }
  const [rdInput, setRdInput] = useState('');
  const [rdBusy, setRdBusy] = useState(false);
  const [rdMsg, setRdMsg] = useState(null);     // { ok, text }

  const applyReplayDir = async (dir) => {
    setRdBusy(true);
    setRdMsg(null);
    try {
      const r = await api.setReplayDir(dir);
      setRdMsg({ ok: true, text: dir == null
        ? `Back to automatic detection — ${r.replays ?? 0} replays found.`
        : `Folder set — ${r.replays ?? 0} replays found, importing new ones now.` });
      setRdInput('');
      api.replayDir().then(setRd).catch(() => {});
      onSaved();
    } catch (e) {
      setRdMsg({ ok: false, text: String(e.message || e) });
    }
    setRdBusy(false);
  };

  useEffect(() => {
    Promise.all([api.players(), api.settings()]).then(([pl, st]) => {
      setPlayers(pl.players);
      setSelected(new Set(st.myAccounts || []));
      setAutoMe(st.autoMe);
    }).catch(() => {});
    api.replayDir().then(setRd).catch(() => {});
  }, []);

  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    await api.saveSettings({ myAccounts: [...selected] }).catch(() => {});
    setSaving(false);
    onSaved();
    onClose();
  };

  const q = query.trim().toLowerCase();
  const shown = players
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .slice(0, 30);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Settings</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-section">
          <div className="rank-cap" style={{ marginBottom: 6 }}>My accounts</div>
          <p className="rank-note" style={{ marginBottom: 12 }}>
            Select all of your accounts — their stats are combined into your profile (matches, W/L, trends).
            If none are selected, the account with the most matches is tracked.
          </p>
          <input
            className="search-input" style={{ width: '100%', marginBottom: 10 }}
            placeholder="Search players by name…"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
          <div className="account-list">
            {shown.map((p) => (
              <label key={p.player_key} className={`account-row ${selected.has(p.player_key) ? 'sel' : ''}`}>
                <input type="checkbox" checked={selected.has(p.player_key)} onChange={() => toggle(p.player_key)} />
                <span className="acc-name">{p.name}</span>
                <span className="acc-meta">{p.matches} games{p.player_key === autoMe && !selected.size ? ' · auto-tracked' : ''}</span>
              </label>
            ))}
            {!shown.length && <div className="rank-note" style={{ padding: 10 }}>No results.</div>}
          </div>
        </div>

        <div className="modal-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="rank-cap" style={{ marginBottom: 6 }}>Replay folder</div>
          <p className="rank-note" style={{ marginBottom: 10 }}>
            The tracker watches this folder for new replays. Rocket League saves them
            automatically (Settings → Replays) — usually under Documents.
          </p>
          {rd && (
            <div className="rdir-current">
              <code className="rdir-path">{rd.current}</code>
              <span className="rank-note">
                {rd.exists
                  ? <>{rd.replays ?? 0} replays{rd.source === 'auto' ? ' · auto-detected' : rd.source === 'env' ? ' · from RL_REPLAY_DIR' : ''}</>
                  : <span style={{ color: 'var(--red)' }}>folder not found</span>}
              </span>
            </div>
          )}
          {rd?.candidates?.filter((c) => c.path !== rd.current).map((c) => (
            <button key={c.path} className="rdir-cand" disabled={rdBusy} onClick={() => applyReplayDir(c.path)}>
              Use <code>{c.path}</code> <span className="rank-note">({c.replays} replays)</span>
            </button>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              className="search-input" style={{ flex: '1 1 260px' }}
              placeholder="Paste a folder path, e.g. D:\Replays"
              value={rdInput} onChange={(e) => setRdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && rdInput.trim()) applyReplayDir(rdInput); }}
            />
            <button className="vc-btn" style={{ fontSize: 13 }} disabled={rdBusy || !rdInput.trim()}
              onClick={() => applyReplayDir(rdInput)}>
              {rdBusy ? 'Checking…' : 'Use this folder'}
            </button>
            {rd?.source === 'config' && (
              <button className="vc-btn" style={{ fontSize: 13 }} disabled={rdBusy} onClick={() => applyReplayDir(null)}>
                Reset to automatic
              </button>
            )}
          </div>
          {rdMsg && (
            <div className="rank-note" style={{ marginTop: 8, color: rdMsg.ok ? 'var(--green)' : 'var(--red)' }}>
              {rdMsg.text}
            </div>
          )}
        </div>

        <div className="modal-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="rank-cap" style={{ marginBottom: 6 }}>Backup</div>
          <p className="rank-note" style={{ marginBottom: 10 }}>
            Everything lives in one local SQLite file (matches, stats, ranks, settings).
            Download it as a backup, or restore one — e.g. when moving to a new PC.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <a className="vc-btn" href="/api/backup" style={{ textDecoration: 'none', fontSize: 13 }}>⤓ Download backup</a>
            <button className="vc-btn" style={{ fontSize: 13 }} disabled={!!restoring}
              onClick={() => fileRef.current?.click()}>
              {restoring === 'uploading' ? 'Uploading…' : restoring === 'waiting' ? 'Server restarting…' : '⤒ Restore from backup'}
            </button>
            {restoring === 'error' && <span className="rank-note" style={{ color: 'var(--red)' }}>Restore failed — is the file a valid backup?</span>}
            <input ref={fileRef} type="file" accept=".db" style={{ display: 'none' }}
              onChange={(e) => { doRestore(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>

        <div className="modal-actions">
          <button className="vc-btn" onClick={() => setSelected(new Set())}>Clear (automatic)</button>
          <button className="sync-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
