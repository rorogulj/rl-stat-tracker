'use strict';
// Manual batch import from the command line: node src/cli-import.js
const importer = require('./importer');
const { stmts } = require('./db');

(async () => {
  console.log('Replay folder:', importer.getReplayDir());
  const pending = importer.pendingFiles();
  console.log('To import:', pending.length, 'replays');
  const t0 = Date.now();
  await importer.importAll();
  console.log('Done in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (importer.progress.errors.length) {
    console.log('Errors:');
    for (const e of importer.progress.errors) console.log(' -', e.file, e.error);
  }
  console.log('Total matches in the database:', stmts.listMatches.all().length);
})();
