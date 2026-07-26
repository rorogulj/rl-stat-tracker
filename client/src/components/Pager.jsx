/** Paginacija: ‹ 1 2 … n › (dijele je Players i Matches tablice). */
export default function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  const nums = [];
  for (let i = 0; i < pages; i++) {
    if (pages > 9 && i > 0 && i < pages - 1 && Math.abs(i - page) > 2) {
      if (nums[nums.length - 1] !== '…') nums.push('…');
    } else nums.push(i);
  }
  return (
    <div className="pager">
      <button className="pager-btn" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</button>
      {nums.map((n, i) => n === '…'
        ? <span key={'e' + i} className="pager-ellipsis">…</span>
        : <button key={n} className={`pager-btn ${n === page ? 'active' : ''}`} onClick={() => onPage(n)}>{n + 1}</button>)}
      <button className="pager-btn" disabled={page === pages - 1} onClick={() => onPage(page + 1)}>›</button>
    </div>
  );
}
