import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/anton';
import '@fontsource/condiment';
import './index.css';
import App from './App.jsx';
import Welcome from './pages/Welcome.jsx';
import InfoPage from './pages/InfoPage.jsx';
import { isDemo } from './api.js';

/** /info without a running server (public site, phones): the article standalone,
 *  with a minimal bar back to the landing instead of the app chrome. */
function InfoStandalone() {
  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="logo">
          <img src="/logo-icon-transparent.svg" alt="" className="logo-img" />
          RL Stat Tracker
        </a>
        <a href="/" className="w-btn sm info-sa-home">← Home</a>
      </header>
      <main className="page">
        <InfoPage />
      </main>
    </div>
  );
}

/** Mount the app only when a local server answers; otherwise show the landing. */
function Boot() {
  const [state, setState] = useState(isDemo() ? 'up' : 'checking'); // demo mounts straight away
  useEffect(() => {
    if (isDemo()) return undefined;
    let alive = true;
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => alive && setState('up'))
      .catch(() => alive && setState('down'));
    return () => { alive = false; };
  }, []);

  if (state === 'checking') {
    // splash fades in after a short delay (CSS), so fast local responses never flash it
    return (
      <div className="boot-splash">
        <img src="/logo-icon-transparent.svg" alt="" />
      </div>
    );
  }
  if (state === 'down') {
    if (window.location.pathname === '/info') return <InfoStandalone />;
    return <Welcome onUp={() => setState('up')} />;
  }
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>
);
