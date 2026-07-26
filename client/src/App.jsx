import { useEffect, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { useParams } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Matches from './pages/Matches.jsx';
import MatchDetail from './pages/MatchDetail.jsx';
import Opponents from './pages/Opponents.jsx';
import Compare from './pages/Compare.jsx';
import ServerStatus from './pages/ServerStatus.jsx';
import InfoPage from './pages/InfoPage.jsx';
import RankLadder from './pages/RankLadder.jsx';
import ModeFilter from './components/ModeFilter.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import PlayerSearch from './components/PlayerSearch.jsx';

function PlayerProfile({ mode }) {
  const { key } = useParams();
  return <Dashboard key={'p' + key + mode} mode={mode} playerKey={key} />;
}

/** Full-screen overlay while the server replaces itself; reloads when it's back on the new version. */
function UpdateOverlay({ target }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/status');
        if (r.ok) {
          const s = await r.json();
          if (!target || s.version === target) { clearInterval(id); window.location.reload(); }
        }
      } catch { /* server still down — keep waiting */ }
      if (Date.now() - started > 10 * 60 * 1000) { clearInterval(id); setFailed(true); }
    }, 3000);
    return () => clearInterval(id);
  }, [target]);
  return (
    <div className="modal-backdrop update-overlay">
      <div className="card update-card">
        {failed ? (
          <>
            <div className="upd-title">Update did not come back</div>
            <p>The server has not restarted after 10 minutes. Re-run the installer
              command from the welcome page, or start the tracker manually.</p>
          </>
        ) : (
          <>
            <div className="upd-title">Updating{target ? ` to v${target}` : ''}…</div>
            <p>The tracker is downloading the new version and restarting.
              This page reloads automatically — usually within a couple of minutes.</p>
            <div className="upd-spinner" />
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  // smooth transition between routes: the old page crossfades into the new one (View Transitions API)
  const [displayLocation, setDisplayLocation] = useState(location);
  useEffect(() => {
    if (location === displayLocation) return;
    const apply = () => {
      setDisplayLocation(location);
      window.scrollTo(0, 0);
    };
    if (document.startViewTransition) {
      document.startViewTransition(() => { flushSync(apply); });
    } else {
      apply();
    }
  }, [location]); // eslint-disable-line
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setModeState] = useState(() => localStorage.getItem('rl_mode') ?? null);
  const [showSettings, setShowSettings] = useState(false);

  const setMode = (m) => {
    localStorage.setItem('rl_mode', m);
    setModeState(m);
  };

  // first visit: automatically pick the most-played mode
  useEffect(() => {
    if (mode !== null) return;
    api.matches().then((r) => {
      const counts = {};
      for (const m of r.matches) counts[m.team_size] = (counts[m.team_size] || 0) + 1;
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      setMode(best ? String(best[0]) : '');
    }).catch(() => setMode(''));
  }, [mode]);

  const poll = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      return s;
    } catch { return null; }
  }, []);

  useEffect(() => { poll(); }, [poll]);

  // while an import is running, poll and refresh the data when it finishes
  useEffect(() => {
    if (!status?.progress?.running && !syncing) return;
    const id = setInterval(async () => {
      const s = await poll();
      if (s && !s.progress.running) {
        setSyncing(false);
        setRefreshKey((k) => k + 1);
        clearInterval(id);
      }
    }, 1200);
    return () => clearInterval(id);
  }, [status?.progress?.running, syncing, poll]);

  const doSync = async () => {
    setSyncing(true);
    await api.triggerImport();
    poll();
  };

  // update check: once at load (server caches the GitHub lookup for 6 h)
  const [upd, setUpd] = useState(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => { api.update().then(setUpd).catch(() => {}); }, []);
  const doUpdate = async () => {
    if (upd?.dev) {
      window.alert('This copy is a git checkout — update it with git pull.');
      return;
    }
    setUpdating(true);
    try { await api.runUpdate(); } catch { /* server may already be shutting down */ }
  };

  const prog = status?.progress;

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="logo">
          <img src="/logo-icon-transparent.svg" alt="" className="logo-img" />
          RL Stat Tracker
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>Profile</NavLink>
          <NavLink to="/matches">Matches</NavLink>
          <NavLink to="/opponents">Players</NavLink>
          <NavLink to="/compare">Compare</NavLink>
          <NavLink to="/ladder">Ladder</NavLink>
          {/* dev machine only — regular installs reach it directly at /server (troubleshooting) */}
          {status?.dev && <NavLink to="/server">Server</NavLink>}
          <NavLink to="/info">Info</NavLink>
        </nav>
        <PlayerSearch />
        <ModeFilter mode={mode ?? ''} onChange={setMode} />
        {upd?.available && (
          <button className="update-btn" onClick={doUpdate} title={`Update to v${upd.latest} (current v${upd.current})`}>
            ↑ v{upd.latest}
          </button>
        )}
        <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
        <button className="sync-btn" onClick={doSync} disabled={prog?.running}>
          {prog?.running ? `Importing ${prog.done}/${prog.total}…` : 'Sync'}
        </button>
      </header>

      {updating && <UpdateOverlay target={upd?.latest} />}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {prog?.running && (
        <div className="loading-bar">
          <div className="fill" style={{ width: `${(prog.done / Math.max(1, prog.total)) * 100}%` }} />
        </div>
      )}

      {status?.replayDirExists === false && (
        <div className="warn-banner">
          <b>Replay folder not found:</b> <code>{status.replayDir}</code> — if your Documents
          folder lives in OneDrive or elsewhere, set the <code>RL_REPLAY_DIR</code> environment
          variable to your replay folder. Also make sure Rocket League saves replays
          (Settings → Replays → autosave).
        </div>
      )}
      {status && (status.progress?.errors?.length > 0) && !status.progress?.running && (
        <div className="warn-banner bad">
          <b>Replays are failing to import</b> ({status.progress.errors.length} errors) — open{' '}
          <a href="/server">localhost:7845/server</a> for details. An antivirus quarantining
          the replay parser (rrrocket.exe) is the usual cause.
        </div>
      )}

      {/* progress bar on route change (like Safari/YouTube) */}
      <div className="route-progress" key={'rp' + displayLocation.pathname} />

      {/* key per route → animated transition on every page change */}
      <main className="page" key={displayLocation.pathname}>
        <Routes location={displayLocation}>
          <Route path="/" element={<Dashboard key={'d' + refreshKey + (mode ?? '')} mode={mode ?? ''} />} />
          <Route path="/matches" element={<Matches key={'m' + refreshKey + (mode ?? '')} mode={mode ?? ''} />} />
          <Route path="/opponents" element={<Opponents key={'o' + refreshKey + (mode ?? '')} mode={mode ?? ''} />} />
          <Route path="/player/:key" element={<PlayerProfile mode={mode ?? ''} />} />
          <Route path="/compare" element={<Compare key={'c' + refreshKey + (mode ?? '')} mode={mode ?? ''} />} />
          <Route path="/match/:id" element={<MatchDetail />} />
          <Route path="/ladder" element={<RankLadder key={'l' + (mode ?? '')} mode={mode ?? ''} />} />
          <Route path="/server" element={<ServerStatus />} />
          <Route path="/info" element={<InfoPage />} />
        </Routes>
      </main>
    </div>
  );
}
