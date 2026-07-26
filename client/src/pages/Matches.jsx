import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtDate, fmtDur } from '../api.js';
import Pager from '../components/Pager.jsx';
import Scribble from '../components/Scribble.jsx';

const PAGE_SIZE = 20;

const myGf = (m) => (m.me ? (m.me.team === 0 ? m.team0_score : m.team1_score) : 0);
const myGa = (m) => (m.me ? (m.me.team === 0 ? m.team1_score : m.team0_score) : 0);

// table columns: get returns the value used for sorting (null → to the bottom)
const COLS = [
  { key: 'date', label: 'Date', get: (m) => m.date },
  { key: 'result', label: 'Result', get: (m) => (m.me?.win ?? 0) * 100 + (myGf(m) - myGa(m)) },
  { key: 'map', label: 'Arena', get: (m) => (m.map || '').toLowerCase(), asc: true },
  { key: 'vs', label: 'Opponents', get: (m) => (m.opponents || []).join(', ').toLowerCase(), asc: true },
  { key: 'dur', label: 'Length', get: (m) => m.duration },
  { key: 'goals', label: 'G', get: (m) => m.me?.goals },
  { key: 'assists', label: 'A', get: (m) => m.me?.assists },
  { key: 'saves', label: 'Sv', get: (m) => m.me?.saves },
  { key: 'shots', label: 'Sh', get: (m) => m.me?.shots },
  { key: 'score', label: 'Score', get: (m) => m.me?.score },
  { key: 'rating', label: 'Rating', get: (m) => m.me?.gameScore },
];

export default function Matches({ mode = '' }) {
  const [data, setData] = useState(null);
  const [sort, setSort] = useState({ key: 'date', dir: -1 });
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setPage(0);
    api.matches(null, mode || null).then(setData).catch(() => setData({ matches: [] }));
  }, [mode]);

  // session = one calendar day; we show the last 3
  const sessions = useMemo(() => {
    if (!data?.matches) return [];
    const byDay = new Map();
    for (const m of data.matches.filter((x) => x.me)) {
      const day = (m.date || '').slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { day, matches: [] });
      byDay.get(day).matches.push(m);
    }
    for (const s of byDay.values()) s.matches.sort((a, b) => (a.date < b.date ? -1 : 1));
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 3);
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.matches) return [];
    const needle = q.trim().toLowerCase();
    let arr = data.matches.filter((m) => m.me);
    if (needle) {
      arr = arr.filter((m) =>
        (m.map || '').toLowerCase().includes(needle)
        || (m.opponents || []).some((n) => n.toLowerCase().includes(needle))
        || (m.teammates || []).some((n) => n.toLowerCase().includes(needle)));
    }
    const col = COLS.find((c) => c.key === sort.key) || COLS[0];
    arr = [...arr].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    return arr;
  }, [data, q, sort]);

  const exportCsv = () => {
    const rows = [['date', 'map', 'mode', 'result', 'score', 'opponents', 'my_goals', 'my_assists', 'my_saves', 'my_shots', 'my_score', 'rating', 'overtime', 'mvp']];
    for (const m of filtered) {
      rows.push([
        m.date, m.map, `${m.team_size}v${m.team_size}`, m.me.win > 0 ? 'W' : m.me.win < 0 ? 'L' : 'D',
        `${m.team0_score}-${m.team1_score}`, (m.opponents || []).join('; '),
        m.me.goals, m.me.assists, m.me.saves, m.me.shots, m.me.score,
        m.me.gameScore ?? '', m.overtime ? 1 : 0, m.me.mvp ? 1 : 0,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `rl-matches${mode ? '-' + mode + 'v' + mode : ''}.csv`;
    a.click();
  };

  if (!data) return <div className="empty"><h3>Loading…</h3></div>;
  if (!data.matches.length) return (
    <div className="empty"><h3>No matches</h3><p>Click "Sync" to import replays.</p></div>
  );

  const mine = data.matches.filter((m) => m.me);
  const wins = mine.filter((m) => m.me.win > 0).length;
  const pages = Math.ceil(filtered.length / PAGE_SIZE);
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const clickSort = (col) => {
    setPage(0);
    setSort((s) => s.key === col.key
      ? { key: col.key, dir: -s.dir }
      : { key: col.key, dir: col.asc ? 1 : -1 });
  };

  return (
    <>
      {/* SESSIONS — last 3 days of play */}
      <h2 className="section-title">Sessions <Scribble>history</Scribble>
        <span className="sheet-note">a session = one day of play · last 3 shown</span>
      </h2>
      <div className="session-grid">
        {sessions.map((s) => {
          const w = s.matches.filter((m) => m.me.win > 0).length;
          const gf = s.matches.reduce((a, m) => a + myGf(m), 0);
          const ga = s.matches.reduce((a, m) => a + myGa(m), 0);
          const goals = s.matches.reduce((a, m) => a + m.me.goals, 0);
          const ratings = s.matches.map((m) => m.me.gameScore).filter((v) => v != null);
          const dropping = ratings.length >= 4 && (() => {
            const last3 = ratings.slice(-3);
            const avgAll = ratings.reduce((a, b) => a + b, 0) / ratings.length;
            const avg3 = last3.reduce((a, b) => a + b, 0) / 3;
            return avg3 < avgAll - 7 || (last3[0] > last3[1] && last3[1] > last3[2]);
          })();
          const spark = (() => {
            if (ratings.length < 2) return null;
            const lo = Math.min(...ratings) - 4, hi = Math.max(...ratings) + 4;
            return ratings.map((v, k) => `${(k / (ratings.length - 1)) * 100},${24 - ((v - lo) / (hi - lo)) * 22}`).join(' ');
          })();
          const dayLabel = new Date(s.day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          return (
            <div key={s.day} className="card session-card">
              <div className="sess-date">{dayLabel}
                {dropping && <span className="badge tilt" style={{ marginLeft: 10 }} title="Your rating dropped over the last games of this session">Form dropping</span>}
              </div>
              <div className="sess-line">
                <span className={`sess-rec ${w > s.matches.length - w ? 'pos' : w < s.matches.length - w ? 'neg' : ''}`}>{w}–{s.matches.length - w}</span>
                <span className="sess-meta">{s.matches.length} games · GF {gf} · GA {ga} · {goals} goals by you</span>
                {spark && (
                  <svg className="sess-spark" viewBox="0 0 100 26" preserveAspectRatio="none">
                    <polyline points={spark} pathLength="1" fill="none" stroke={dropping ? 'var(--red)' : 'var(--accent)'} strokeWidth="2"
                      strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
              </div>
              <div className="sess-dots">
                {s.matches.map((m) => (
                  <Link key={m.id} to={`/match/${encodeURIComponent(m.id)}`}
                    className={`sess-dot ${m.me.win > 0 ? 'w' : m.me.win < 0 ? 'l' : 'd'}`}
                    title={`${m.map} · ${m.team0_score}-${m.team1_score}${m.me.gameScore != null ? ' · rating ' + m.me.gameScore : ''}`} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ALL MATCHES — sortable table with search */}
      <h2 className="section-title">
        <span className="accent">▮</span> All matches
        <span style={{ fontSize: 14, color: '#7e88ab', letterSpacing: 1 }}>
          {mine.length} · {wins}W {mine.filter((m) => m.me.win < 0).length}L{mine.some((m) => m.me.win === 0) ? ` ${mine.filter((m) => m.me.win === 0).length}D` : ''}
        </span>
        <input
          className="search-input" style={{ width: 240 }}
          placeholder="Search arena or player…"
          value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
        />
        <button className="trn-refresh" onClick={exportCsv}>Export CSV</button>
      </h2>
      <div className="cmp-wrap card">
        <table className="cmp opp-table match-table">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={`sortable ${sort.key === c.key ? 'sorted' : ''}`} onClick={() => clickSort(c)}>
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const res = m.me.win > 0 ? 'w' : m.me.win < 0 ? 'l' : 'd';
              const r = m.me.gameScore;
              return (
                <tr key={m.id} className="match-row" onClick={() => navigate(`/match/${encodeURIComponent(m.id)}`)}>
                  <td style={{ color: '#7e88ab', fontSize: 12.5 }}>{fmtDate(m.date)}</td>
                  <td>
                    <span className={`result-pill ${res}`}>{res.toUpperCase()}</span>
                    <span style={{ marginLeft: 9, fontWeight: 650 }}>
                      <span style={{ color: 'var(--blue)' }}>{m.team0_score}</span>
                      <span style={{ color: '#4d5678' }}> : </span>
                      <span style={{ color: 'var(--orange)' }}>{m.team1_score}</span>
                    </span>
                    {m.overtime && <span className="badge ot" style={{ marginLeft: 8 }}>OT</span>}
                    {m.me.mvp && <span className="badge mvp" style={{ marginLeft: 6 }}>MVP</span>}
                  </td>
                  <td style={{ fontWeight: 600 }}>{m.map}</td>
                  <td style={{ color: '#b9c2dd', fontSize: 12.5, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {(m.opponents || []).join(', ') || '—'}
                  </td>
                  <td>{fmtDur(m.duration)}</td>
                  <td>{m.me.goals}</td>
                  <td>{m.me.assists}</td>
                  <td>{m.me.saves}</td>
                  <td>{m.me.shots}</td>
                  <td>{m.me.score}</td>
                  <td>
                    {r != null && (
                      <span className={`rating-chip ${r >= 70 ? 'hi' : r >= 45 ? 'mid' : 'lo'}`}>{r}</span>
                    )}
                  </td>
                  <td style={{ color: '#4d5678' }}>›</td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={12} style={{ textAlign: 'center', color: '#7e88ab', padding: 24 }}>No matches found for "{q}"</td></tr>
            )}
          </tbody>
        </table>
        <Pager page={page} pages={pages} onPage={setPage} />
      </div>
    </>
  );
}
