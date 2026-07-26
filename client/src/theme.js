/**
 * Central palette for charts and canvas/WebGL views (Orbis skin).
 * INVARIANT: TEAM_BLUE/TEAM_ORANGE = --blue/--orange in index.css,
 * RGB triplets in field.js/ShotMap.jsx.
 */
export const NAVY = '#010828';
export const PANEL = '#071033';
export const CREAM = '#EFF4FF';
export const NEON = '#6FFF00';

export const TEAM_BLUE = '#55a3f5';
export const TEAM_ORANGE = '#f09a52';
export const TEAM_BLUE_RGB = '85,163,245';
export const TEAM_ORANGE_RGB = '240,154,82';

export const WIN = NEON;
export const LOSS = '#ff6d6d';
export const GOLD = '#ffd166';
export const VIOLET = '#a78bfa';

export const TICK = '#7e88ab';
export const FAINT = '#4d5678';
export const GRID = 'rgba(239,244,255,0.07)';
export const REF = 'rgba(239,244,255,0.18)';

export const MMR_SERIES = [NEON, TEAM_BLUE, VIOLET];

export const tooltipStyle = {
  background: PANEL,
  border: '1px solid rgba(239,244,255,0.18)',
  borderRadius: 12,
  fontSize: 12,
  color: CREAM,
};

/** color by rating threshold (1-99): hi/mid/lo */
export const tierColor = (v) => (v >= 70 ? WIN : v >= 45 ? GOLD : LOSS);

export const BUCKET_COLORS = {
  bronze: '#b0723a', silver: '#9aa3ad', gold: '#dcb35a', platinum: '#7fd4d8',
  diamond: '#5aa0e8', champion: '#a78bfa', 'grand-champion': '#f26d9c', ssl: '#f5f5f5',
};
