import { tierInfo } from '../tiers.js';

/** Rank badge sa stvarnom RL ikonom (lokalno u /ranks/{tier}.png). */
export default function RankBadge({ tier, label, size = 'md', estimate = false }) {
  const t = tierInfo(tier);
  if (!t) return null;
  const idx = Math.max(0, Math.min(22, Math.round(tier)));
  return (
    <span className={`rank-badge ${size}`} style={{ '--rc': t.color }} title={label || t.name}>
      <img className="rank-icon" src={`/ranks/${idx}.png`} alt="" />
      <span className="rn">{t.name}{estimate ? ' ~' : ''}</span>
    </span>
  );
}
