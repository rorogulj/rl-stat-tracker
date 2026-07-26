// Regenerate the golden analyzer snapshot AFTER an intentional analyzer change.
// Review the diff of server/test/golden.snapshot.json before committing — that
// diff IS the behavioral change you are shipping.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { analyzeFixture, summarize, SNAPSHOT, FIXTURES } = require(path.join(root, 'server', 'test', 'golden-lib.js'));
const { ANALYZER_VERSION } = require(path.join(root, 'server', 'src', 'analyzer.js'));

const out = { analyzerVersion: ANALYZER_VERSION, fixtures: {} };
for (const f of fs.readdirSync(FIXTURES).filter((x) => x.endsWith('.replay')).sort()) {
  out.fixtures[f] = summarize(analyzeFixture(f));
  console.log(`${f}: ${out.fixtures[f].teamSize}v${out.fixtures[f].teamSize} ${out.fixtures[f].score.join(':')} · xG ${out.fixtures[f].teamXg[0]}:${out.fixtures[f].teamXg[1]}`);
}
fs.writeFileSync(SNAPSHOT, JSON.stringify(out, null, 2));
console.log(`snapshot written for analyzer v${ANALYZER_VERSION}`);
