'use strict';
/**
 * Resolve the Rocket League replay folder. Documents is frequently redirected
 * (OneDrive backup is the consumer-Windows default), so the shell's registry
 * entry is consulted first. Shared by the importer and the db-migration guard
 * (no other local requires — db.js must be able to use this before importer loads).
 *
 * A user-chosen folder (Settings → Replay folder) is persisted in
 * <data>/config.json and wins over auto-detection; the RL_REPLAY_DIR env var
 * stays supported as an escape hatch in between.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// same resolution as db.js (installed copies set RL_DATA_DIR) — kept inline so
// this module stays require-able before the database opens
const DATA_DIR = process.env.RL_DATA_DIR || path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function configuredReplayDir() {
  const v = readConfig().replayDir;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Persist (or with null: clear) the user-chosen replay folder. */
function saveReplayDir(dir) {
  const cfg = readConfig();
  if (dir) cfg.replayDir = dir; else delete cfg.replayDir;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/** Candidate Documents roots, most likely first (registry → OneDrive → homedir). */
function documentsCandidates() {
  const docCandidates = [];
  try {
    const out = require('child_process').execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Personal',
      { encoding: 'utf8', windowsHide: true });
    const m = out.match(/Personal\s+REG(?:_EXPAND)?_SZ\s+(.+)/);
    if (m) docCandidates.push(m[1].trim().replace(/%USERPROFILE%/i, os.homedir()));
  } catch { /* registry unavailable */ }
  if (process.env.OneDrive) docCandidates.push(path.join(process.env.OneDrive, 'Documents'));
  docCandidates.push(path.join(os.homedir(), 'Documents'));
  return docCandidates;
}

function autoDetectReplayDir() {
  const docCandidates = documentsCandidates();
  for (const docs of docCandidates) {
    for (const sub of ['DemosEpic', 'Demos']) {
      const p = path.join(docs, 'My Games', 'Rocket League', 'TAGame', sub);
      if (fs.existsSync(p)) return p;
    }
  }
  return path.join(docCandidates[0], 'My Games', 'Rocket League', 'TAGame', 'DemosEpic');
}

function defaultReplayDir() {
  return configuredReplayDir() || process.env.RL_REPLAY_DIR || autoDetectReplayDir();
}

/** 'config' | 'env' | 'auto' — where the current folder comes from. */
function replayDirSource() {
  if (configuredReplayDir()) return 'config';
  if (process.env.RL_REPLAY_DIR) return 'env';
  return 'auto';
}

function countReplays(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.replay')).length;
  } catch {
    return null; // folder missing/unreadable — distinct from "0 replays"
  }
}

/** Existing replay folders on this machine (for the Settings picker). */
function detectedCandidates() {
  const seen = new Set();
  const out = [];
  for (const docs of documentsCandidates()) {
    for (const sub of ['DemosEpic', 'Demos']) {
      const p = path.join(docs, 'My Games', 'Rocket League', 'TAGame', sub);
      if (seen.has(p.toLowerCase())) continue;
      seen.add(p.toLowerCase());
      if (fs.existsSync(p)) out.push({ path: p, replays: countReplays(p) ?? 0 });
    }
  }
  return out;
}

/** Number of .replay files in the resolved folder (0 when the folder is missing). */
function replayFileCount() {
  return countReplays(defaultReplayDir()) ?? 0;
}

module.exports = {
  defaultReplayDir, replayFileCount, replayDirSource,
  saveReplayDir, detectedCandidates, countReplays,
};
