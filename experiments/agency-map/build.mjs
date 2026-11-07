import {build} from 'esbuild';
import fs from 'node:fs/promises';
await build({entryPoints:['main.jsx'],bundle:true,minify:true,jsx:'automatic',outdir:'dist',loader:{'.woff2':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await fs.writeFile('index.html',`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Bancos e crédito no Brasil."><title>Atlas · Agências</title><link rel="stylesheet" href="dist/main.css"></head><body><div id="root"></div><script src="dist/main.js"></script></body></html>`);
for(const name of ['maplibre-gl-worker.mjs','maplibre-gl-shared.mjs'])await fs.copyFile('node_modules/maplibre-gl/dist/'+name,'dist/'+name);
console.log('Estudo construído.');
