import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/anton';
import '@fontsource/condiment';
import './index.css';
import App from './App.jsx';
import Welcome from './pages/Welcome.jsx';

/** Mount the app only when a local server answers; otherwise show the landing. */
function Boot() {
  const [state, setState] = useState('checking'); // checking | up | down
  useEffect(() => {
    let alive = true;
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(() => alive && setState('up'))
      .catch(() => alive && setState('down'));
    return () => { alive = false; };
  }, []);

  if (state === 'checking') return null; // navy background, no flash
  if (state === 'down') return <Welcome onUp={() => setState('up')} />;
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
