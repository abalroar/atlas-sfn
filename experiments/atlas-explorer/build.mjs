import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

// A cena de inadimplência é o componente do site (web/src/AtlasScene.jsx) e os cálculos de
// web/src/atlas-data.js, importados sem cópia. React é resolvido uma única vez.
const here = path.resolve('node_modules');
await build({
  entryPoints: ['src/main.jsx'], bundle: true, minify: true, jsx: 'automatic', outdir: 'dist',
  loader: { '.woff2': 'file', '.woff': 'file' }, define: { 'process.env.NODE_ENV': '"production"' },
  alias: { react: path.join(here, 'react'), 'react-dom': path.join(here, 'react-dom') },
  nodePaths: [here, path.resolve('../../web/node_modules')],
});
for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) await fs.copyFile('node_modules/maplibre-gl/dist/' + name, 'dist/' + name);
for (const name of ['atlas-pf.json', 'atlas-pj.json']) await fs.copyFile('../../web/public/data/' + name, 'data/' + name);
await fs.writeFile('index.html', `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Crédito, agências e postos no território brasileiro."><title>Atlas</title><link rel="stylesheet" href="dist/main.css"></head><body><div id="root"></div><script src="dist/main.js"></script></body></html>`);
console.log('Estudo construído.');
