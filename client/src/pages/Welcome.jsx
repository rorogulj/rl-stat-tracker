import { useEffect, useState } from 'react';
import Scribble from '../components/Scribble.jsx';

const REPO = 'https://github.com/rorogulj/rl-stat-tracker';
const INSTALL_CMD = `irm ${REPO.replace('github.com', 'raw.githubusercontent.com')}/main/install.ps1 | iex`;

/**
 * Landing screen shown when no local tracker server responds on /api/status.
 * Covers two cases: the public demo deployment (no backend at all) and a local
 * install where the server simply isn't running. Polls until the server
 * appears, then hands control back via onUp().
 */
function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch { /* clipboard unavailable (http, old browser) — user selects manually */ }
  };
  return (
    <button className={'w-copy' + (done ? ' ok' : '')} onClick={copy}>
      {done ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

export default function Welcome({ onUp }) {
  const [tries, setTries] = useState(0);

  const ping = async () => {
    try {
      const r = await fetch('/api/status');
      if (!r.ok) throw new Error();
      await r.json(); // static hosts may answer 200 with HTML — must parse as JSON
      onUp();
    } catch {
      setTries((t) => t + 1);
    }
  };

  useEffect(() => {
    const id = setInterval(ping, 5000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line

  return (
    <div className="welcome">
      <div className="card welcome-card">
        <img src="/logo-icon-transparent.svg" alt="" className="w-logo" />
        <div className="w-kicker">RL Stat Tracker</div>
        <h1 className="w-title">
          Football-style stats<br />for your Rocket League
        </h1>
        <Scribble style={{ display: 'block', marginTop: 4 }}>all yours, all local</Scribble>

        <p className="w-lead">
          This page is only the interface. The numbers come from a small server that runs
          on <b>your</b> PC — it watches your replay folder, analyzes every match with a
          custom stat engine and keeps everything in a local database. Nothing is uploaded
          anywhere.
        </p>

        <div className="w-status">
          <span className="w-dot" />
          No tracker server found at <code>:7845</code> — retrying automatically
          {tries > 0 ? ` (${tries}×)` : ''}
        </div>

        <div className="w-install">
          <div className="w-install-label">
            Install — open <b>PowerShell</b> (press Start, type "powershell", Enter) and paste:
          </div>
          <div className="w-cmd">
            <code>{INSTALL_CMD}</code>
            <CopyBtn text={INSTALL_CMD} />
          </div>
          <div className="w-install-note">
            Sets everything up in ~2 minutes, adds a desktop shortcut and opens the tracker.
            Run it again anytime to update. <a className="w-link" href={REPO} target="_blank" rel="noreferrer">
            Read the script</a> before running, if you like — it's open source.
          </div>
        </div>

        <div className="w-cta">
          <a className="w-btn primary" href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
          <button className="w-btn" onClick={ping}>Retry now</button>
        </div>

        <details className="w-dev">
          <summary>For developers (manual setup)</summary>
          <div className="w-steps">
            <div>git clone {REPO}</div>
            <div>cd rl-stat-tracker</div>
            <div>npm run setup</div>
            <div>npm start&nbsp;&nbsp;<span className="w-note"># then open http://localhost:7845</span></div>
          </div>
        </details>

        <div className="w-feats">
          xG &amp; finishing · 1–99 game rating · rank estimate vs a 27k-replay benchmark ·
          playstyle archetypes · boost &amp; positioning breakdowns · heatmaps · 2D replay viewer
        </div>
      </div>
    </div>
  );
}
