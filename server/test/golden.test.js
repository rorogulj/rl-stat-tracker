'use strict';
// Golden-replay regression tests: three real replays, analyzed end-to-end
// (rrrocket → analyzer), compared against a reviewed snapshot. Any behavioral
// change to the analyzer MUST come with a version bump and a regenerated
// snapshot (node tools/update-golden.mjs) whose diff was reviewed.
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert');
const { analyzeFixture, summarize, SNAPSHOT } = require('./golden-lib');
const { ANALYZER_VERSION } = require('../src/analyzer');

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

test('snapshot matches the current ANALYZER_VERSION', () => {
  assert.equal(snapshot.analyzerVersion, ANALYZER_VERSION,
    'analyzer changed without regenerating the golden snapshot — run: node tools/update-golden.mjs and review the diff');
});

for (const [file, expected] of Object.entries(snapshot.fixtures)) {
  test(`golden: ${file}`, { skip: snapshot.analyzerVersion !== ANALYZER_VERSION }, () => {
    const actual = summarize(analyzeFixture(file));
    assert.deepStrictEqual(actual, expected);
  });
}
