'use strict';
/**
 * Tracker Network (tracker.gg) — fetching the real rank per playlist.
 * The only thing in the app that goes to the internet; the result is cached locally in settings.
 */
const { stmts } = require('./db');

const TIER_NAMES = [
  'Unranked', 'Bronze I', 'Bronze II', 'Bronze III', 'Silver I', 'Silver II', 'Silver III',
  'Gold I', 'Gold II', 'Gold III', 'Platinum I', 'Platinum II', 'Platinum III',
  'Diamond I', 'Diamond II', 'Diamond III', 'Champion I', 'Champion II', 'Champion III',
  'Grand Champion I', 'Grand Champion II', 'Grand Champion III', 'Supersonic Legend',
];

function tierIndex(name) {
  const i = TIER_NAMES.indexOf(name);
  return i >= 0 ? i : null;
}

const PLAYLIST_TO_MODE = {
  'Ranked Duel 1v1': '1',
  'Ranked Doubles 2v2': '2',
  'Ranked Standard 3v3': '3',
};

const CACHE_KEY = 'trn_rank'; // cache per account: 'trn_rank:<name>'
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 h

function getCached(name) {
  const row = stmts.getSetting.get(name ? CACHE_KEY + ':' + name : CACHE_KEY);
  if (!row || !row.value) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

async function fetchRank(epicName, { force = false } = {}) {
  const cached = getCached(epicName);
  if (!force && cached && cached.name === epicName && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }
  const url = `https://api.tracker.gg/api/v2/rocket-league/standard/profile/epic/${encodeURIComponent(epicName)}`;
  // Node fetch gets a Cloudflare 403 (TLS fingerprint) — system curl gets through
  const { spawnSync } = require('child_process');
  const r = spawnSync('curl.exe', [
    '-s', '--max-time', '15',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    '-H', 'Accept: application/json',
    url,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  let json = null;
  if (r.status === 0 && r.stdout) {
    try { json = JSON.parse(r.stdout); } catch { /* Cloudflare HTML */ }
  }
  if (!json || !json.data) {
    if (cached) return { ...cached, stale: true };
    throw new Error('Tracker.gg unavailable (blocked or offline)');
  }
  const playlists = {};
  for (const seg of json.data.segments || []) {
    if (seg.type !== 'playlist') continue;
    const mode = PLAYLIST_TO_MODE[seg.metadata.name];
    if (!mode) continue;
    const s = seg.stats;
    playlists[mode] = {
      playlist: seg.metadata.name,
      tierName: s.tier ? s.tier.metadata.name : null,
      tier: s.tier ? tierIndex(s.tier.metadata.name) : null,
      division: s.division ? s.division.metadata.name : null,
      mmr: s.rating ? s.rating.value : null,
      matches: s.matchesPlayed ? s.matchesPlayed.value : null,
    };
  }
  const out = { name: epicName, fetchedAt: Date.now(), playlists };
  stmts.setSetting.run(CACHE_KEY + ':' + epicName, JSON.stringify(out));
  // MMR history for the progress chart (key = "me" by name from playerCounts)
  try {
    const me = stmts.playerCounts.all().find((r) => r.name === epicName);
    if (me) recordHistory(me.player_key, playlists);
  } catch { /* don't break the fetch */ }
  return out;
}

function recordHistory(playerKey, playlists) {
  const now = Date.now();
  for (const mode of Object.keys(playlists)) {
    const p = playlists[mode];
    if (p && p.mmr != null) stmts.addRankHistory.run(playerKey, mode, p.mmr, p.tier, now);
  }
}

/** Synchronous cache lookup for the CURRENTLY tracked account — no network call. */
function cachedRankForMode(mode) {
  if (!mode) return null;
  const agg = require('./aggregate'); // lazy require (avoids a circular dependency)
  return cachedPlayerRank(agg.detectMe(), mode);
}

// ---------- ranks of any player (by platform from the replay) ----------

/** Determine the TRN platform from the player_key format + name. */
function platformOf(key, name) {
  if (/^[0-9a-f]{32}$/i.test(key)) return { slug: 'epic', id: name };   // Epic account id → lookup by nick
  if (/^7656\d{13}$/.test(key)) return { slug: 'steam', id: key };      // SteamID64
  if (/^25\d{14}$/.test(key)) return { slug: 'xbl', id: name };         // Xbox XUID → gamertag
  if (key.startsWith('{')) return { slug: 'psn', id: name };            // PSN online_id blob → nick
  return { slug: 'epic', id: name };
}

// global cooldown when tracker.gg rate-limits us (Cloudflare 429 / error 1015)
let blockedUntil = 0;
const isBlocked = () => Date.now() < blockedUntil;
let lastCallAt = 0;
const MIN_GAP_MS = 2500; // minimum gap between any two tracker calls

async function politeGap() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** Returns { kind: 'ok'|'ratelimit'|'net', json? } — distinguishes a real response from a block. */
function curlRaw(url) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('curl.exe', [
    '-s', '--max-time', '15',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    '-H', 'Accept: application/json',
    url,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return { kind: 'net' };
  const body = r.stdout;
  if (/error code: 10\d\d/.test(body) || body.trimStart().startsWith('<')) {
    blockedUntil = Date.now() + 20 * 60 * 1000;
    console.log('[trn] tracker.gg rate limit — pausing 20 min');
    return { kind: 'ratelimit' };
  }
  try { return { kind: 'ok', json: JSON.parse(body) }; } catch { return { kind: 'net' }; }
}

function curlJson(url) {
  const res = curlRaw(url);
  return res.kind === 'ok' ? res.json : null;
}

function parsePlaylists(json) {
  return parseProfile(json).playlists;
}

/** Full parse of a tracker.gg profile: playlists, all-time peaks, lifetime, casual MMR. */
function parseProfile(json) {
  const playlists = {}, peaks = {};
  let lifetime = null, casualMmr = null;
  for (const seg of (json.data && json.data.segments) || []) {
    const name = seg.metadata && seg.metadata.name;
    const s = seg.stats || {};
    if (seg.type === 'playlist') {
      const mode = PLAYLIST_TO_MODE[name];
      if (mode) {
        playlists[mode] = {
          tierName: s.tier ? s.tier.metadata.name : null,
          tier: s.tier ? tierIndex(s.tier.metadata.name) : null,
          division: s.division ? s.division.metadata.name : null,
          mmr: s.rating ? s.rating.value : null,
          matches: s.matchesPlayed ? s.matchesPlayed.value : null,
          winStreak: s.winStreak ? s.winStreak.value : null,
          seasonPeak: s.peakRating ? s.peakRating.value : null,
          seasonPeakTier: s.peakTier ? s.peakTier.value : null,
        };
      } else if (name === 'Casual' && s.rating) {
        casualMmr = s.rating.value;
      }
    } else if (seg.type === 'peak-rating') {
      const mode = PLAYLIST_TO_MODE[name];
      if (mode && s.peakRating) {
        peaks[mode] = {
          mmr: s.peakRating.value,
          tierName: s.peakRating.metadata && s.peakRating.metadata.name !== 'Unranked' ? s.peakRating.metadata.name : null,
        };
      }
    } else if (seg.type === 'overview') {
      lifetime = {
        wins: s.wins ? s.wins.value : null,
        goals: s.goals ? s.goals.value : null,
        saves: s.saves ? s.saves.value : null,
        assists: s.assists ? s.assists.value : null,
        shots: s.shots ? s.shots.value : null,
        mvps: s.mVPs ? s.mVPs.value : null,
        goalShotRatio: s.goalShotRatio ? Math.round(s.goalShotRatio.value * 10) / 10 : null,
        seasonRewardLevel: s.seasonRewardLevel ? s.seasonRewardLevel.value : null,
      };
    }
  }
  return { playlists, peaks, lifetime, casualMmr };
}

/**
 * Smurf heuristic: a combination of tracker signals + our performance estimate.
 * estTierCal = calibrated estimate from our matches (may be null).
 */
function assessSmurf(data, mode, estTierCal) {
  if (!data || !data.playlists) return null;
  const pl = data.playlists[String(mode)];
  const reasons = [];
  if (pl) {
    if (pl.matches != null && pl.matches < 30) reasons.push(`only ${pl.matches} ranked matches this season`);
    if (pl.winStreak != null && pl.winStreak >= 5) reasons.push(`${pl.winStreak}-game win streak`);
    if (data.casualMmr && pl.mmr && data.casualMmr - pl.mmr >= 150) reasons.push('casual MMR far above ranked');
    if (estTierCal != null && pl.tier != null && pl.tier > 0 && estTierCal - pl.tier >= 3) reasons.push('performance well above rank');
  }
  if (data.lifetime && data.lifetime.wins != null && data.lifetime.wins < 150) {
    reasons.push(`only ${data.lifetime.wins} lifetime wins (fresh account)`);
  }
  return { suspect: reasons.length >= 2, signals: reasons.length, reasons };
}

// the cache is NEVER deleted (display works forever); this is just the refresh interval —
// other players' ranks only need a monthly refresh, saves the tracker.gg budget
const PLAYER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Ranks of a single player from a match; cached in the player_ranks table. */
async function fetchPlayerRanks(playerKey, name, { force = false, ttlMs = PLAYER_TTL_MS } = {}) {
  const row = stmts.getPlayerRank.get(playerKey);
  const cachedReal = row && row.data && row.data.length > 2;
  if (!force && row && Date.now() - row.fetched_at < ttlMs) {
    const data = JSON.parse(row.data);
    const full = data.playlists ? data : { playlists: data, peaks: {}, lifetime: null, casualMmr: null };
    return { platform: row.platform, ranks: full.playlists, full, cached: true };
  }
  // under rate limit we don't touch the network and do NOT write a placeholder (the player may exist!)
  if (isBlocked()) {
    if (cachedReal) return { platform: row.platform, ranks: JSON.parse(row.data), cached: true, stale: true };
    return { platform: null, ranks: {}, rateLimited: true };
  }
  const { slug, id } = platformOf(playerKey, name);
  const url = `https://api.tracker.gg/api/v2/rocket-league/standard/profile/${slug}/${encodeURIComponent(id)}`;
  await politeGap();
  const res = curlRaw(url);
  if (res.kind !== 'ok' || !res.json || !res.json.data) {
    if (cachedReal) {
      return { platform: row.platform, ranks: JSON.parse(row.data), cached: true, stale: true };
    }
    if (res.kind === 'ratelimit') return { platform: slug, ranks: {}, rateLimited: true };
    if (res.kind === 'net') return { platform: slug, ranks: {}, netError: true };
    // a real "not found" (valid JSON with no data) — placeholder with a retry in ~45 min
    stmts.setPlayerRank.run(playerKey, name, slug, JSON.stringify({}), Date.now() - PLAYER_TTL_MS + 45 * 60 * 1000);
    return { platform: slug, ranks: {}, notFound: true };
  }
  const full = parseProfile(res.json);
  stmts.setPlayerRank.run(playerKey, name, slug, JSON.stringify(full), Date.now());
  recordHistory(playerKey, full.playlists);
  return { platform: slug, ranks: full.playlists, full };
}

/** Synchronous cache of a player's FULL tracker data (no network). */
function cachedPlayerFull(playerKey) {
  const row = stmts.getPlayerRank.get(playerKey);
  if (!row) return null;
  try {
    const data = JSON.parse(row.data);
    return data.playlists ? data : { playlists: data, peaks: {}, lifetime: null, casualMmr: null };
  } catch { return null; }
}

/** Synchronous cache of a player's rank for a mode (with all-time peak) — for display in aggregates. */
function cachedPlayerRank(playerKey, mode) {
  const full = cachedPlayerFull(playerKey);
  if (!full) return null;
  if (!mode) return full.playlists;
  const pl = full.playlists[String(mode)];
  if (!pl) return null;
  return { ...pl, peak: full.peaks[String(mode)] || null };
}

module.exports = { fetchRank, cachedRankForMode, getCached, fetchPlayerRanks, cachedPlayerRank, cachedPlayerFull, assessSmurf, platformOf, isBlocked };
