import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

/** Player search in the top bar → opens the player's profile. */
export default function PlayerSearch() {
  const [players, setPlayers] = useState([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { api.players().then((r) => setPlayers(r.players)).catch(() => {}); }, []);

  // if the first fetch failed (e.g. the server was still starting up), retry on focus
  const ensurePlayers = () => {
    if (!players.length) api.players().then((r) => setPlayers(r.players)).catch(() => {});
  };

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const results = q ? players.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8) : [];

  const go = (key) => {
    setQuery(''); setOpen(false);
    navigate(`/player/${encodeURIComponent(key)}`);
  };

  return (
    <div className="player-search" ref={wrapRef}>
      <input
        className="search-input"
        placeholder="Search player…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); ensurePlayers(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && results.length) go(results[0].player_key); }}
      />
      {open && q && (
        <div className="search-results">
          {results.map((p) => (
            <button key={p.player_key} className="search-item" onClick={() => go(p.player_key)}>
              <span>{p.name}</span>
              <span className="acc-meta">{p.matches} games</span>
            </button>
          ))}
          {!results.length && <div className="search-empty">No players found</div>}
        </div>
      )}
    </div>
  );
}
