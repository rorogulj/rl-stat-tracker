// Publish locally trained GBDT models: copy server/data/gbdt-rank-*.json into
// server/models/ (tracked by git) and write a manifest. Commit + push the result
// and every installed copy picks the new models up within a day (syncRemoteModels).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.RL_DATA_DIR || path.join(ROOT, 'server', 'data');
const DST = path.join(ROOT, 'server', 'models');

fs.mkdirSync(DST, { recursive: true });
const manifest = { publishedAt: new Date().toISOString(), models: {} };

for (const mode of [1, 2, 3]) {
  const src = path.join(SRC, `gbdt-rank-${mode}.json`);
  if (!fs.existsSync(src)) {
    console.log(`mode ${mode}: no trained model in ${SRC} — skipped`);
    continue;
  }
  const model = JSON.parse(fs.readFileSync(src, 'utf8'));
  fs.copyFileSync(src, path.join(DST, `gbdt-rank-${mode}.json`));
  manifest.models[mode] = {
    trainedAt: model.trainedAt, valMAE: model.valMAE, baseMAE: model.baseMAE ?? null,
    nRows: model.nRows, trees: model.trees.length,
  };
  console.log(`mode ${mode}: published (trained ${model.trainedAt}, val MAE ${model.valMAE} vs baseline ${model.baseMAE ?? '?'}, ${model.nRows} rows)`);
}

fs.writeFileSync(path.join(DST, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('manifest written — commit & push server/models to publish');
