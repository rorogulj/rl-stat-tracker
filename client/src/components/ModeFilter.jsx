const MODES = [['', 'All'], ['1', '1v1'], ['2', '2v2'], ['3', '3v3']];

export default function ModeFilter({ mode, onChange }) {
  return (
    <div className="mode-filter">
      {MODES.map(([v, label]) => (
        <button key={v} className={`mf ${mode === v ? 'active' : ''}`} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}
