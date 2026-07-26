import { useEffect, useRef, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { BUCKET_COLORS } from '../theme.js';
import Scribble from '../components/Scribble.jsx';

const BUCKET_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion', 'grand-champion', 'ssl'];

const fmtUptime = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};
const fmtTime = (t) => new Date(t).toLocaleTimeString('en-GB');

/** "Updates" row: current state + a manual "Check now" (bypasses the 6 h cache). */
function UpdateRow() {
  const [upd, setUpd] = useState(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { api.update().then(setUpd).catch(() => {}); }, []);
  const checkNow = async () => {
    setChecking(true);
    try { setUpd(await api.update(true)); } catch { /* offline */ }
    setChecking(false);
  };
  let text = 'checking…';
  if (upd) {
    if (upd.disabled) text = 'checks disabled (RL_NO_UPDATE_CHECK)';
    else if (upd.available) text = `v${upd.latest} available — use the ↑ button in the top bar`;
    else if (upd.dev) text = `up to date (v${upd.current}, git checkout — update via git pull)`;
    else if (upd.latest) text = `up to date (v${upd.current})`;
    else text = `v${upd.current} — could not reach GitHub to compare`;
  }
  return (
    <div className="srow" style={{ gridTemplateColumns: '110px 1fr' }}>
      <span className="slbl">Updates</span>
      <span className="sval srv-val">
        {text}
        {!upd?.disabled && (
          <button className="linklike" onClick={checkNow} disabled={checking}>
            {checking ? 'checking…' : 'Check now'}
          </button>
        )}
      </span>
    </div>
  );
}

const MODEL_SOURCE = { local: 'trained locally', remote: 'auto-downloaded', shipped: 'bundled with the app' };

function GbdtCard({ gbdt }) {
  return (
    <div className="card coach-panel">
      <div className="sheet-h">
        <span className={`status-dot ${Object.values(gbdt).some((g) => g.training) ? 'busy' : Object.values(gbdt).some((g) => g.trees) ? 'ok' : 'idle'}`} />
        GBDT rank model
      </div>
      {['1', '2', '3'].map((m) => {
        const g = gbdt[m] || {};
        return (
          <div key={m} className="srow" style={{ gridTemplateColumns: '46px 1fr' }}>
            <span className="slbl">{m}v{m}</span>
            <span className="sval srv-val">
              {g.training ? 'training…'
                : g.trees
                  ? `${g.trees} trees · ${g.nRows.toLocaleString('en-GB')} rows · val MAE ${g.valMAE}${g.baseMAE != null ? ` (baseline ${g.baseMAE})` : ''} tiers · calibrated on ${g.calibrated} known ranks${MODEL_SOURCE[g.source] ? ` · ${MODEL_SOURCE[g.source]}` : ''}`
                  : 'no model yet'}
            </span>
          </div>
        );
      })}
      <div className="footnote">
        Pure-JS gradient-boosted trees. Models come bundled with the app and newer published
        ones are picked up automatically; with your own ballchasing corpus they retrain locally
        (the newest model wins). Predictions are calibrated to tracker.gg ranks of players
        from your own matches.
      </div>
    </div>
  );
}

export default function ServerStatus() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const poll = () => api.server()
      .then((d) => { if (alive) { setS(d); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [s?.logs?.length]);

  if (err && !s) return (
    <div className="empty">
      <h3><span className="status-dot bad" /> Server not responding</h3>
      <p>The local server on port 7845 is not answering. Start it with <b>npm start</b> or log out/in (auto-start).</p>
    </div>
  );
  if (!s) return <div className="empty"><h3>Loading…</h3></div>;

  const dl = s.benchDl, bi = s.benchImport;
  const dlRemaining = dl ? Math.max(0, dl.target - dl.downloaded) : 0;
  const dlEtaH = dlRemaining ? Math.round((dlRemaining * 18.5) / 360) / 10 : 0;

  return (
    <>
      <h2 className="section-title">Server <Scribble>engine room</Scribble>
        <span className="sheet-note">refreshes every 5 s</span>
      </h2>

      <div className="srv-grid">
        {/* SERVER */}
        <div className="card coach-panel">
          <div className="sheet-h"><span className={`status-dot ${err ? 'bad' : 'ok'}`} /> Server process</div>
          {[
            ['Status', err ? 'not responding' : 'running'],
            ['Version', s.version ? 'v' + s.version : '—'],
            ['Uptime', fmtUptime(s.uptimeSec)],
            ['Started', fmtDate(new Date(s.startedAt).toISOString())],
            ['Address', `http://localhost:${s.port} (PID ${s.pid}, node ${s.node})`],
            ['Watching', s.replayDir],
          ].map(([l, v]) => (
            <div key={l} className="srow" style={{ gridTemplateColumns: '110px 1fr' }}>
              <span className="slbl">{l}</span><span className="sval srv-val">{v}</span>
            </div>
          ))}
          <UpdateRow />
          <div className="footnote">Auto-starts hidden at every Windows login (start-server.vbs in Startup)</div>
        </div>

        {/* MY REPLAYS */}
        <div className="card coach-panel">
          <div className="sheet-h"><span className={`status-dot ${s.import.progress.running ? 'busy' : 'ok'}`} /> Your replays</div>
          {[
            ['Imported matches', s.db.matches],
            ['Pending files', s.import.pending],
            ['Importing now', s.import.progress.running ? `${s.import.progress.done}/${s.import.progress.total} (${s.import.progress.current || ''})` : 'no'],
            ['Last import run', s.import.progress.lastRun ? fmtDate(s.import.progress.lastRun) : '—'],
          ].map(([l, v]) => (
            <div key={l} className="srow" style={{ gridTemplateColumns: '150px 1fr' }}>
              <span className="slbl">{l}</span><span className="sval srv-val">{v}</span>
            </div>
          ))}
          <div className="footnote">New replays are picked up automatically seconds after you save them in game</div>
        </div>

        {/* TRACKER + DATABASE */}
        <div className="card coach-panel">
          <div className="sheet-h">Database & rank cache</div>
          {[
            ['Database', `${s.db.path.split('\\').pop()} · ${s.db.sizeMB} MB`],
            ['Player rows', s.db.playerRows],
            ['Replay timelines', s.db.timelines],
            ['tracker.gg cached players', s.db.rankCache],
            ['…of which failed lookups', `${s.db.rankCacheEmpty} (auto-retry)`],
          ].map(([l, v]) => (
            <div key={l} className="srow" style={{ gridTemplateColumns: '190px 1fr' }}>
              <span className="slbl">{l}</span><span className="sval srv-val">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* BENCHMARK DOWNLOAD */}
      {dl && (
        <div className="srv-grid" style={{ marginTop: 12 }}>
          <div className="card coach-panel" style={{ gridColumn: 'span 2' }}>
            <div className="sheet-h">
              <span className={`status-dot ${dl.active ? 'busy' : dl.downloaded >= dl.target ? 'ok' : 'idle'}`} />
              Ballchasing download — benchmark corpus
              <span className="sheet-note">phase 2: targets ×4 (~{dl.target.toLocaleString('en-GB')} replays) for the GBDT rank model · auto-resumes after reboot</span>
            </div>
            <div className="srow" style={{ gridTemplateColumns: '150px 1fr' }}>
              <span className="slbl">Progress</span>
              <span className="sval srv-val">
                {dl.downloaded} / {dl.target} replays
                {dl.active ? ` · downloading (~${dlEtaH} h left)` : dl.downloaded >= dl.target ? ' · complete ✓' : ' · PAUSED — run: npm run benchmark:download'}
                {dl.failed ? ` · ${dl.failed} failed` : ''}
              </span>
            </div>
            <div className="loading-bar" style={{ margin: '8px 0 14px' }}>
              <div className="fill" style={{ width: `${Math.min(100, (dl.downloaded / dl.target) * 100)}%` }} />
            </div>
            {bi && (
              <>
                <div className="srow" style={{ gridTemplateColumns: '150px 1fr' }}>
                  <span className="slbl">Analyzed</span>
                  <span className="sval srv-val">
                    {bi.matches.toLocaleString('en-GB')} / {dl.files.toLocaleString('en-GB')} replays in the database
                    {bi.running ? ` · analyzing now (${bi.pending.toLocaleString('en-GB')} in this round)` :
                      bi.matches < dl.files ? ' · next round within 10 min' : ' · all analyzed ✓'}
                  </span>
                </div>
                <div className="loading-bar" style={{ margin: '8px 0 14px' }}>
                  <div className="fill" style={{ width: `${Math.min(100, (bi.matches / Math.max(1, dl.files)) * 100)}%` }} />
                </div>
              </>
            )}
            {(dl.jobs || []).map((job) => (
              <div key={job.playlist} style={{ marginBottom: 12 }}>
                <div className="rank-cap" style={{ marginBottom: 6 }}>
                  {job.label} — {job.done}/{job.target * 8}
                  {job.done >= job.target * 8 ? ' ✓' : ''}
                </div>
                <div className="bucket-grid">
                  {BUCKET_ORDER.map((b) => {
                    const n = job.perBucket[b] || 0;
                    return (
                      <div key={b} className="bucket-cell">
                        <span className="bucket-name" style={{ color: BUCKET_COLORS[b] }}>{b}</span>
                        <span className="pbar" style={{ width: '100%' }}>
                          <span className="pfill" style={{ width: `${Math.min(100, (n / job.target) * 100)}%`, background: BUCKET_COLORS[b] }} />
                        </span>
                        <span className="bucket-n">{n}/{job.target}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="footnote">
              Folder (shareable): {dl.folder} · last activity {dl.lastActivity ? fmtTime(dl.lastActivity) : '—'}
              {bi && <> · imported into DB: <b style={{ color: 'var(--text)' }}>{bi.matches}</b> matches / {bi.players} player rows{bi.running ? ` (importing, ${bi.pending} left)` : ''}</>}
            </div>
            {dl.logTail?.length > 0 && (
              <pre className="srv-log" style={{ maxHeight: 130, marginTop: 10 }}>{dl.logTail.join('\n')}</pre>
            )}
          </div>

          {/* GBDT RANK MODEL */}
          {s.gbdt && <GbdtCard gbdt={s.gbdt} />}
        </div>
      )}

      {/* no corpus (regular installs): the model card still shows, on its own row */}
      {!dl && s.gbdt && (
        <div className="srv-grid" style={{ marginTop: 12 }}>
          <GbdtCard gbdt={s.gbdt} />
        </div>
      )}

      {/* SERVER LOG */}
      <h2 className="section-title" style={{ marginTop: 26 }}><span className="accent">▮</span> Server log
        <span className="sheet-note">last {s.logs.length} lines · live</span>
      </h2>
      <div className="card" style={{ padding: 14 }}>
        <pre className="srv-log" ref={logRef}>
          {s.logs.map((l) => `${fmtTime(l.t)}  ${l.line}`).join('\n') || '(no output yet)'}
        </pre>
      </div>
    </>
  );
}
