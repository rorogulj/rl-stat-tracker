// Downloads the official rrrocket release (the replay parser) from GitHub and
// verifies its SHA-256 before placing it at tools/rrrocket.exe. The repo itself
// ships no binaries — this script is the only way the parser gets here, and it
// refuses anything that doesn't match the pinned hash of the official release.
// Re-run with --force to re-download.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.11.5';
const URL = `https://github.com/nickbabcock/rrrocket/releases/download/v${VERSION}/rrrocket-${VERSION}-x86_64-pc-windows-msvc.zip`;
const ZIP_SHA256 = '673de08ad50270b800ac11ea72beca3764ef0ba1da205e0080973ae0e553c0f3';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(TOOLS, 'rrrocket.exe');

if (fs.existsSync(DEST) && process.argv[2] !== '--force') {
  console.log('rrrocket.exe already present — use --force to re-download');
  process.exit(0);
}

console.log(`downloading rrrocket v${VERSION} (official release)…`);
const res = await fetch(URL);
if (!res.ok) {
  console.error(`download failed: HTTP ${res.status}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
const hash = crypto.createHash('sha256').update(buf).digest('hex');
if (hash !== ZIP_SHA256) {
  console.error(`SHA-256 mismatch!\n  expected ${ZIP_SHA256}\n  got      ${hash}\nRefusing to install.`);
  process.exit(1);
}

const tmpZip = path.join(TOOLS, 'rrrocket-tmp.zip');
const tmpDir = path.join(TOOLS, 'rrrocket-tmp');
fs.writeFileSync(tmpZip, buf);
fs.rmSync(tmpDir, { recursive: true, force: true });
execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${tmpDir}' -Force`]);
const found = fs.readdirSync(tmpDir, { recursive: true }).find((f) => String(f).endsWith('rrrocket.exe'));
if (!found) {
  console.error('rrrocket.exe not found in the archive');
  process.exit(1);
}
fs.copyFileSync(path.join(tmpDir, String(found)), DEST);
fs.rmSync(tmpZip);
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`rrrocket.exe v${VERSION} installed (zip SHA-256 verified)`);
