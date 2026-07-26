import { useEffect, useState } from 'react';
import { api } from '../api.js';
import RankBadge from '../components/RankBadge.jsx';
import { STAT_DEFS } from '../statDefs.js';
import Scribble from '../components/Scribble.jsx';

/** Two-player comparison, FBref-style: one row per stat, better value highlighted. */
export default function Compare({ mode = '' }) {
  const [players, setPlayers] = useState([]);
  const [keyA, setKeyA] = useState('');
  const [keyB, setKeyB] = useState('');
  const [profA, setProfA] = useState(null);
  const [profB, setProfB] = useState(null);
  const [fbA, setFbA] = useState(false); // player has no matches in the selected mode → all modes shown
  const [fbB, setFbB] = useState(false);

  // profile with a fallback to all modes when the filter has no data
  const loadProfile = async (key, setProf, setFb) => {
    let p = await api.profile(key, mode || null).catch(() => null);
    let fb = false;
    if (!p && mode) {
      p = await api.profile(key, null).catch(() => null);
      fb = !!p;
    }
    setProf(p);
    setFb(fb);
  };

  useEffect(() => {
    api.players().then((r) => {
      setPlayers(r.players);
      if (!keyA && r.me) setKeyA(r.me);
      if (!keyB) {
        const other = r.players.find((pl) => pl.player_key !== r.me);
        if (other) setKeyB(other.player_key);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line

  useEffect(() => { if (keyA) loadProfile(keyA, setProfA, setFbA); }, [keyA, mode]); // eslint-disable-line
  useEffect(() => { if (keyB) loadProfile(keyB, setProfB, setFbB); }, [keyB, mode]); // eslint-disable-line

  const teamMode = mode !== '1';
  const defs = STAT_DEFS.filter((d) => !d.teamOnly || teamMode);
  const cats = [...new Set(defs.map((d) => d.cat))];

  const Sel = ({ value, onChange, exclude }) => (
    <select className="rank-select" style={{ minWidth: 220 }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— select player —</option>
      {players.filter((pl) => pl.player_key !== exclude).map((pl) => (
        <option key={pl.player_key} value={pl.player_key}>{pl.name} ({pl.matches})</option>
      ))}
    </select>
  );

  const Head = ({ p, selected, fb, side }) => p ? (
    <div className="cmp-head">
      <div className={`cmp-head-name ${side}`}>{p.name}</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {(p.rank.replayTier ?? p.rank.trn?.tier) != null && <RankBadge tier={p.rank.replayTier ?? p.rank.trn.tier} size="sm" />}
        {p.rank.estTierRecent != null && <RankBadge tier={p.rank.estTierRecent} size="sm" estimate />}
      </div>
      <div className="rank-note" style={{ marginTop: 6 }}>
        {p.games} games · {p.wins}–{p.losses} ({p.winPct.toFixed(0)}%){p.style ? ` · ${p.style.archetype}` : ''}
      </div>
      {fb && (
        <div className="rank-note" style={{ marginTop: 4, color: 'var(--gold)' }}>
          no {mode}v{mode} games — showing all modes
        </div>
      )}
    </div>
  ) : (
    <div className="rank-note" style={{ textAlign: 'center', padding: 20 }}>
      {selected ? 'no data for this player' : 'select a player'}
    </div>
  );

  return (
    <>
      <h2 className="section-title">Player comparison <Scribble>head to head</Scribble>
        <span className="sheet-note">{mode ? `${mode}v${mode}` : 'all modes'} · per-game averages from your replay database</span>
      </h2>

      <div className="compare-pick card">
        <Sel value={keyA} onChange={setKeyA} exclude={keyB} />
        <span className="rank-vs">VS</span>
        <Sel value={keyB} onChange={setKeyB} exclude={keyA} />
      </div>

      {(profA || profB) && (
        <div className="compare-wrap card">
          <div className="compare-heads">
            <Head p={profA} selected={!!keyA} fb={fbA} side="a" />
            <div className="rank-vs" style={{ alignSelf: 'center' }}>VS</div>
            <Head p={profB} selected={!!keyB} fb={fbB} side="b" />
          </div>

          {/* quick verdict: average game rating + who wins more stats */}
          {profA && profB && (() => {
            const ra = profA.coaching?.avgGameScore, rb = profB.coaching?.avgGameScore;
            let a = 0, b = 0, tied = 0;
            for (const d of defs) {
              const va = d.get(profA), vb = d.get(profB);
              if (va == null || vb == null || va === vb) { tied++; continue; }
              if (d.invert ? va < vb : va > vb) a++; else b++;
            }
            const tot = a + b + tied;
            return (
              <div className="cmp-summary">
                <div className={`cmp-score a ${ra != null && rb != null && ra > rb ? 'lead' : ''}`}>{ra?.toFixed(0) ?? '—'}</div>
                <div className="cmp-score-mid">
                  <div className="rank-cap">Overall rating</div>
                  <div className="rank-note">avg game rating (1–99) from replays</div>
                </div>
                <div className={`cmp-score b ${ra != null && rb != null && rb > ra ? 'lead' : ''}`}>{rb?.toFixed(0) ?? '—'}</div>
                <div className="cmp-tally-bar">
                  <span className="ta" style={{ width: `${(a / tot) * 100}%` }} />
                  <span className="tt" style={{ width: `${(tied / tot) * 100}%` }} />
                  <span className="tb" style={{ width: `${(b / tot) * 100}%` }} />
                </div>
                <div className="cmp-tally-note">
                  <b style={{ color: 'var(--blue)' }}>{profA.name}</b> better in <b>{a}</b> of {tot} stats
                  {tied > 0 && <> · {tied} even</>} · <b style={{ color: 'var(--orange)' }}>{profB.name}</b> in <b>{b}</b>
                </div>
              </div>
            );
          })()}

          {cats.map((cat) => (
            <div key={cat}>
              <div className="sheet-h">{cat}</div>
              {defs.filter((d) => d.cat === cat).map((d) => {
                const va = profA ? d.get(profA) : null;
                const vb = profB ? d.get(profB) : null;
                const better = va != null && vb != null && va !== vb
                  ? (d.invert ? (va < vb ? 'a' : 'b') : (va > vb ? 'a' : 'b'))
                  : null;
                const max = Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0)) || 1;
                return (
                  <div key={d.key} className="crow">
                    <span className={`cv ${better === 'a' ? 'best' : ''}`}>{va != null ? va.toFixed(d.dec) + (d.suffix || '') : '—'}</span>
                    <span className="cbar left"><span className={`cfill ${better === 'a' ? 'win' : ''}`} style={{ width: `${(Math.abs(va ?? 0) / max) * 100}%` }} /></span>
                    <span className="clbl">{d.label}{d.invert ? ' ↓' : ''}</span>
                    <span className="cbar right"><span className={`cfill b ${better === 'b' ? 'win' : ''}`} style={{ width: `${(Math.abs(vb ?? 0) / max) * 100}%` }} /></span>
                    <span className={`cv right ${better === 'b' ? 'best' : ''}`}>{vb != null ? vb.toFixed(d.dec) + (d.suffix || '') : '—'}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="footnote" style={{ marginTop: 12 }}>↓ = lower is better · highlighted value = better player for that stat</div>
        </div>
      )}
    </>
  );
}
