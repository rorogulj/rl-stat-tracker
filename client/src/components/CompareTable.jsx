/**
 * Stat comparison table: rows = statistics, columns = players.
 * rows: [{ label, get(playerStats) -> number, fmt?, lowerBetter? }]
 */
export default function CompareTable({ players, rows, meKey }) {
  const sorted = [...players].sort((a, b) => a.team - b.team || b.core.score - a.core.score);
  return (
    <div className="cmp-wrap card">
      <table className="cmp">
        <thead>
          <tr>
            <th>Statistic</th>
            {sorted.map((p) => (
              <th key={p.key} className={(p.team === 0 ? 't0' : 't1') + (p.key === meKey ? ' me-col' : '')}>
                {p.name}{p.mvp ? ' (MVP)' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const vals = sorted.map((p) => row.get(p));
            const valid = vals.filter((v) => v != null && !Number.isNaN(v));
            const best = valid.length ? (row.lowerBetter ? Math.min(...valid) : Math.max(...valid)) : null;
            const showBest = valid.length > 1 && new Set(valid).size > 1;
            return (
              <tr key={row.label}>
                <td className="stat-name">{row.label}</td>
                {sorted.map((p, i) => {
                  const v = vals[i];
                  const isBest = showBest && v === best;
                  return (
                    <td key={p.key} className={(isBest ? 'best ' : '') + (p.key === meKey ? 'me-col' : '')}>
                      {v == null ? '—' : row.fmt ? row.fmt(v) : v}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
