'use strict';
/**
 * Resolve the Rocket League replay folder. Documents is frequently redirected
 * (OneDrive backup is the consumer-Windows default), so the shell's registry
 * entry is consulted first. Shared by the importer and the db-migration guard
 * (no other local requires — db.js must be able to use this before importer loads).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function defaultReplayDir() {
  if (process.env.RL_REPLAY_DIR) return process.env.RL_REPLAY_DIR;
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
  for (const docs of docCandidates) {
    for (const sub of ['DemosEpic', 'Demos']) {
      const p = path.join(docs, 'My Games', 'Rocket League', 'TAGame', sub);
      if (fs.existsSync(p)) return p;
    }
  }
  return path.join(docCandidates[0], 'My Games', 'Rocket League', 'TAGame', 'DemosEpic');
}

/** Number of .replay files in the resolved folder (0 when the folder is missing). */
function replayFileCount() {
  try {
    return fs.readdirSync(defaultReplayDir()).filter((f) => f.toLowerCase().endsWith('.replay')).length;
  } catch {
    return 0;
  }
}

module.exports = { defaultReplayDir, replayFileCount };
