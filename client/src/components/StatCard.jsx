import CountUp from './CountUp.jsx';

export default function StatCard({ icon, value, label, sub, decimals = 0, suffix = '', index = 0 }) {
  return (
    <div className="stat-card" style={{ '--i': index }}>
      {icon && <div className="icon">{icon}</div>}
      <div className="val"><CountUp value={value} decimals={decimals} suffix={suffix} /></div>
      <div className="lbl">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
