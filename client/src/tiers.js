// Rocket League rank tierovi (0-22)
const TIERS = [
  { name: 'Unranked', short: '—', color: '#8a93ad', icon: '·' },
  { name: 'Bronze I', short: 'B1', color: '#b45309', icon: '🥉' },
  { name: 'Bronze II', short: 'B2', color: '#b45309', icon: '🥉' },
  { name: 'Bronze III', short: 'B3', color: '#b45309', icon: '🥉' },
  { name: 'Silver I', short: 'S1', color: '#9ca3af', icon: '🥈' },
  { name: 'Silver II', short: 'S2', color: '#9ca3af', icon: '🥈' },
  { name: 'Silver III', short: 'S3', color: '#9ca3af', icon: '🥈' },
  { name: 'Gold I', short: 'G1', color: '#eab308', icon: '🥇' },
  { name: 'Gold II', short: 'G2', color: '#eab308', icon: '🥇' },
  { name: 'Gold III', short: 'G3', color: '#eab308', icon: '🥇' },
  { name: 'Platinum I', short: 'P1', color: '#67e8f9', icon: '💠' },
  { name: 'Platinum II', short: 'P2', color: '#67e8f9', icon: '💠' },
  { name: 'Platinum III', short: 'P3', color: '#67e8f9', icon: '💠' },
  { name: 'Diamond I', short: 'D1', color: '#60a5fa', icon: '💎' },
  { name: 'Diamond II', short: 'D2', color: '#60a5fa', icon: '💎' },
  { name: 'Diamond III', short: 'D3', color: '#60a5fa', icon: '💎' },
  { name: 'Champion I', short: 'C1', color: '#a78bfa', icon: '👑' },
  { name: 'Champion II', short: 'C2', color: '#a78bfa', icon: '👑' },
  { name: 'Champion III', short: 'C3', color: '#a78bfa', icon: '👑' },
  { name: 'Grand Champion I', short: 'GC1', color: '#f472b6', icon: '🔥' },
  { name: 'Grand Champion II', short: 'GC2', color: '#f472b6', icon: '🔥' },
  { name: 'Grand Champion III', short: 'GC3', color: '#f472b6', icon: '🔥' },
  { name: 'Supersonic Legend', short: 'SSL', color: '#f8fafc', icon: '⚡' },
];

export function tierInfo(tier) {
  if (tier == null) return null;
  const i = Math.max(0, Math.min(22, Math.round(tier)));
  return TIERS[i];
}

export function tierName(tier) {
  const t = tierInfo(tier);
  return t ? t.name : '—';
}

export const ALL_TIERS = TIERS;
