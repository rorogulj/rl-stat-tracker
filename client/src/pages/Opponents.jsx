import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import RankBadge from '../components/RankBadge.jsx';
import Pager from '../components/Pager.jsx';
import Scribble from '../components/Scribble.jsx';

const PAGE_SIZE = 15;

// opponent table columns: get returns the value used for sorting (null → to the bottom)
const COLS = [
  { key: 'name', label: 'Player', get: (o) => o.name.toLowerCase(), asc: true },
  { key: 'rank', label: 'Rank', get: (o) => o.realRank?.tier ?? o.estTier },
  { key: 'arch', label: 'Archetype', get: (o) => o.archetype, asc: true },
  { key: 'peak', label: 'Peak', get: (o) => o.realRank?.peak?.mmr },
  { key: 'games', label: 'Games', get: (o) => o.asOpponent },
  { key: 'record', label: 'Your record', get: (o) => o.winsVs - o.lossesVs },
  { key: 'winpct', label: 'Win %', get: (o) => o.winPctVs },
  { key: 'score', label: 'Score/gm', get: (o) => o.avg?.score },
  { key: 'goals', label: 'Goals/gm', get: (o) => o.avg?.goals },
  { key: 'xg', label: 'xG/gm', get: (o) => o.avg?.xg },
  { key: 'ss', label: 'Supersonic', get: (o) => o.avg?.pctSupersonic },
  { key: 'boost', label: 'Boost/min', get: (o) => o.avg?.boostPerMin },
  { key: 'last', label: 'Last match', get: (o) => o.lastDate },
];

export default function Opponents({ mode = '' }) {
  const [data, setData] = useState(null);
  const [sort, setSort] = useState({ key: 'games', dir: -1 });
  const [page, setPage] = useState(0);
  const [view, setView] = useState('opp'); // 'opp' | 'mates' | 'fav'
  const [pageM, setPageM] = useState(0);
  const [favs, setFavs] = useState([]);

  useEffect(() => {
    setPage(0);
    api.opponents(null, mode || null).then(setData).catch(() => setData({ opponents: [] }));
    api.favorites().then((d) => setFavs(d.favorites)).catch(() => {});
  }, [mode]);

  const opps = useMemo(() => {
    if (!data) return [];
    const col = COLS.find((c) => c.key === sort.key) || COLS[3];
    const arr = data.opponents.filter((o) => o.asOpponent > 0);
    arr.sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // null always goes to the bottom, regardless of direction
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
    return arr;
  }, [data, sort]);

  if (!data) return <div className="empty"><h3>Loading…</h3></div>;

  const mates = data.opponents.filter((o) => o.asTeammate > 0)
    .sort((a, b) => b.asTeammate - a.asTeammate);
  const pages = Math.ceil(opps.length / PAGE_SIZE);
  const shown = opps.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pagesM = Math.ceil(mates.length / PAGE_SIZE);
  const shownM = mates.slice(pageM * PAGE_SIZE, (pageM + 1) * PAGE_SIZE);

  const clickSort = (col) => {
    setPage(0);
    setSort((s) => s.key === col.key
      ? { key: col.key, dir: -s.dir }
      : { key: col.key, dir: col.asc ? 1 : -1 });
  };

  const Th = ({ col }) => (
    <th className={`sortable ${sort.key === col.key ? 'sorted' : ''}`} onClick={() => clickSort(col)}>
      {col.label}{sort.key === col.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const toggleFav = async (key, name) => {
    const d = await api.toggleFavorite(key, name).catch(() => null);
    if (d) setFavs(d.favorites);
  };
  const favKeys = new Set(favs.map((f) => f.key));

  const Tabs = () => (
    <div className="pill-select" style={{ justifyContent: 'flex-start' }}>
      <button className={`pill ${view === 'opp' ? 'active t0' : ''}`} onClick={() => setView('opp')}>Opponents</button>
      <button className={`pill ${view === 'mates' ? 'active t1' : ''}`} onClick={() => setView('mates')}>Teammates</button>
      <button className={`pill ${view === 'fav' ? 'active ball' : ''}`} onClick={() => setView('fav')}>★ Favorites{favs.length ? ` (${favs.length})` : ''}</button>
    </div>
  );

  if (view === 'fav') {
    // join favorites with data from the opponents list (opponent and/or teammate)
    const rows = favs.map((f) => ({ ...f, o: data.opponents.find((o) => o.key === f.key) || null }));
    return (
      <>
        <h2 className="section-title">Favorite players <Scribble>rivals</Scribble>
          <span className="sheet-note">{favs.length} saved · star a player on their profile to add them</span>
        </h2>
        <Tabs />
        {!rows.length ? <p style={{ color: '#7e88ab' }}>No favorites yet — open a player's profile and hit the ☆ next to their name.</p> : (
          <div className="cmp-wrap card">
            <table className="cmp opp-table">
              <thead>
                <tr>
                  <th>Player</th><th>Rank</th><th>Vs you</th><th>Your record</th>
                  <th>With you</th><th>Score/gm</th><th>Goals/gm</th><th>Last match</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, name, o }) => (
                  <tr key={key}>
                    <td style={{ fontWeight: 600 }}>
                      <Link to={`/player/${encodeURIComponent(key)}`} style={{ color: 'var(--accent)' }}>{o?.name || name}</Link>
                      {o?.smurf?.suspect && <span className="smurf-badge" style={{ marginLeft: 7 }}>smurf?</span>}
                    </td>
                    <td>
                      {o?.realRank?.tier != null ? <RankBadge tier={o.realRank.tier} size="sm" />
                        : o?.estTier != null ? <RankBadge tier={o.estTier} size="sm" estimate /> : '—'}
                    </td>
                    <td>{o?.asOpponent || 0}</td>
                    <td>
                      {o?.asOpponent ? (
                        <>
                          <span style={{ color: '#6FFF00', fontWeight: 700 }}>{o.winsVs}</span>
                          <span style={{ color: '#4d5678' }}> : </span>
                          <span style={{ color: '#ff6d6d', fontWeight: 700 }}>{o.lossesVs}</span>
                        </>
                      ) : '—'}
                    </td>
                    <td>{o?.asTeammate || 0}</td>
                    <td>{o?.avg?.score ?? '—'}</td>
                    <td>{o?.avg?.goals ?? '—'}</td>
                    <td style={{ color: '#7e88ab', fontSize: 12 }}>{o?.lastDate ? fmtDate(o.lastDate) : '—'}</td>
                    <td>
                      <button className="fav-btn on" style={{ fontSize: 18, verticalAlign: 0, margin: 0 }}
                        title="Remove from favorites" onClick={() => toggleFav(key, name)}>★</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="footnote">Stats reflect the current mode filter — a favorite you never met in this mode shows only their name.</p>
      </>
    );
  }

  if (view === 'mates') {
    return (
      <>
        <h2 className="section-title">Teammates <Scribble>rivals</Scribble>
          <span className="sheet-note">{mates.length} players · sorted by games together</span>
        </h2>
        <Tabs />
        {!mates.length ? <p style={{ color: '#7e88ab' }}>No teammates for this filter.</p> : (
          <div className="cmp-wrap card">
            <table className="cmp">
              <thead>
                <tr>
                  <th>Player</th><th>Est. rank</th><th>Archetype</th><th>Games together</th><th>Record together</th><th>Win %</th>
                  <th title="Win % together vs your overall win %">Chemistry</th>
                  <th title="Your avg rating in games with them vs your overall avg">Your rating with</th>
                  <th>Last match</th>
                </tr>
              </thead>
              <tbody>
                {shownM.map((o) => {
                  const wp = o.asTeammate ? Math.round((o.winsWith / o.asTeammate) * 100) : null;
                  const chem = wp != null && data.myWinPct != null ? Math.round(wp - data.myWinPct) : null;
                  const rDelta = o.myRatingWith != null && data.myAvgRating != null ? Math.round((o.myRatingWith - data.myAvgRating) * 10) / 10 : null;
                  return (
                    <tr key={o.key}>
                      <td style={{ fontWeight: 600 }}>
                        <Link to={`/player/${encodeURIComponent(o.key)}`} style={{ color: 'var(--accent)' }}>{o.name}</Link>
                        {favKeys.has(o.key) && <span style={{ color: 'var(--gold)', marginLeft: 6 }} title="Favorite">★</span>}
                      </td>
                      <td>{o.estTier != null ? <RankBadge tier={o.estTier} size="sm" estimate /> : '—'}</td>
                      <td style={{ fontSize: 12, color: '#b9c2dd' }}>{o.archetype || '—'}</td>
                      <td>{o.asTeammate}</td>
                      <td>
                        <span style={{ color: '#6FFF00', fontWeight: 700 }}>{o.winsWith}</span>
                        <span style={{ color: '#4d5678' }}> : </span>
                        <span style={{ color: '#ff6d6d', fontWeight: 700 }}>{o.lossesWith}</span>
                      </td>
                      <td className={wp >= 50 ? 'best' : ''}>{wp != null ? wp + '%' : '—'}</td>
                      <td>
                        {chem == null ? '—' : (
                          <span className={`ks-delta ${chem >= 0 ? 'good' : 'bad'}`}>{chem >= 0 ? '+' : ''}{chem}%</span>
                        )}
                      </td>
                      <td>
                        {o.myRatingWith == null ? '—' : (
                          <>
                            <b>{o.myRatingWith}</b>
                            {rDelta != null && (
                              <span style={{ color: rDelta >= 0 ? '#6FFF00' : '#ff6d6d', fontSize: 12, marginLeft: 6 }}>
                                ({rDelta >= 0 ? '+' : ''}{rDelta})
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td style={{ color: '#7e88ab', fontSize: 12 }}>{fmtDate(o.lastDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={pageM} pages={pagesM} onPage={setPageM} />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <h2 className="section-title">Opponents <Scribble>rivals</Scribble>
        <span className="sheet-note">{opps.length} players · click a column to sort</span>
      </h2>
      <Tabs />

      {!opps.length ? <p style={{ color: '#7e88ab' }}>No opponents for this filter.</p> : (
        <div className="cmp-wrap card">
          <table className="cmp opp-table">
            <thead>
              <tr>{COLS.map((c) => <Th key={c.key} col={c} />)}</tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.key}>
                  <td style={{ fontWeight: 600 }}>
                    <Link to={`/player/${encodeURIComponent(o.key)}`} style={{ color: 'var(--accent)' }}>{o.name}</Link>
                    {favKeys.has(o.key) && <span style={{ color: 'var(--gold)', marginLeft: 6 }} title="Favorite">★</span>}
                    {o.smurf?.suspect && (
                      <span className="smurf-badge" style={{ marginLeft: 7 }} title={'Signals:\n· ' + o.smurf.reasons.join('\n· ')}>smurf?</span>
                    )}
                  </td>
                  <td>
                    {o.realRank?.tier != null
                      ? <span title={`${o.realRank.division || ''}${o.realRank.mmr ? ' · ' + o.realRank.mmr + ' MMR' : ''}${o.realRank.matches ? ' · ' + o.realRank.matches + ' matches' : ''}`}><RankBadge tier={o.realRank.tier} size="sm" /></span>
                      : o.estTier != null ? <RankBadge tier={o.estTier} size="sm" estimate /> : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: '#b9c2dd' }}>{o.archetype || '—'}</td>
                  <td style={{ fontSize: 12.5, color: '#b9c2dd' }}>
                    {o.realRank?.peak?.mmr ? <>{o.realRank.peak.mmr}{o.realRank.peak.tierName ? <span style={{ color: '#7e88ab' }}> ({o.realRank.peak.tierName})</span> : null}</> : '—'}
                  </td>
                  <td>{o.asOpponent}</td>
                  <td>
                    <span style={{ color: '#6FFF00', fontWeight: 700 }}>{o.winsVs}</span>
                    <span style={{ color: '#4d5678' }}> : </span>
                    <span style={{ color: '#ff6d6d', fontWeight: 700 }}>{o.lossesVs}</span>
                  </td>
                  <td className={o.winPctVs >= 50 ? 'best' : ''}>{o.winPctVs != null ? o.winPctVs + '%' : '—'}</td>
                  <td>{o.avg?.score ?? '—'}</td>
                  <td>{o.avg?.goals ?? '—'}</td>
                  <td>{o.avg?.xg ?? '—'}</td>
                  <td>{o.avg ? o.avg.pctSupersonic + '%' : '—'}</td>
                  <td>{o.avg?.boostPerMin ?? '—'}</td>
                  <td style={{ color: '#7e88ab', fontSize: 12 }}>{fmtDate(o.lastDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
      )}

    </>
  );
}
