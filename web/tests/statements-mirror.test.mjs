import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {engineBases, exportWheels, pyodideIndexes} from '../src/statements-worker.js';

const root = new URL('../public/pyodide/v0.29.3/full/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../public/data/statements/engine/manifest.json', import.meta.url), 'utf8'));
const mirror = JSON.parse(await readFile(new URL('atlas-mirror.json', root), 'utf8'));
const lock = JSON.parse(await readFile(new URL('pyodide-lock.json', root), 'utf8')).packages;

test('the self-hosted Pyodide matches the engine version and the official lock, byte for byte', async () => {
  assert.equal(mirror.pyodide, manifest.pyodide.version);
  const present = new Set((await readdir(root)).filter(name => name !== 'atlas-mirror.json'));
  assert.deepEqual(new Set(mirror.files.map(file => file.file)), present);
  for (const file of mirror.files) {
    const bytes = await readFile(new URL(file.file, root));
    assert.equal(bytes.length, file.size, file.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.file);
  }
  for (const name of ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) assert.ok(present.has(name), name);
  // Every package the engine loads, with its dependencies, is in the mirror with the hash Pyodide checks.
  const needed = new Set(), stack = [...manifest.packages.builtIn];
  while (stack.length) {const name = stack.pop(); if (needed.has(name)) continue; needed.add(name); stack.push(...(lock[name].depends || []));}
  for (const name of needed) {
    const entry = mirror.files.find(file => file.file === lock[name].file_name);
    assert.ok(entry, name);
    assert.equal(entry.sha256, lock[name].sha256, name);
  }
});

test('export wheels come from the site for the exact pinned requirements, and PyPI is only the last resort', () => {
  const plan = exportWheels(manifest, mirror);
  assert.equal(plan.source, 'mirror');
  assert.deepEqual(plan.wheels.map(wheel => wheel.requirement), manifest.packages.pip);
  assert.ok(plan.wheels.every(wheel => mirror.files.some(file => file.file === wheel.file && file.sha256 === wheel.sha256)));
  assert.equal(exportWheels({...manifest, packages: {...manifest.packages, pip: ['XlsxWriter==9.9.9']}}, mirror).source, 'pypi', 'a different version never falls back to a mismatched local file');
  assert.equal(exportWheels(manifest, null).source, 'pypi');
  const declared = {...manifest, packages: {...manifest.packages, wheels: [{path: 'wheels/x.whl', sha256: 'a'.repeat(64), size: 1}]}};
  assert.equal(exportWheels(declared, mirror).source, 'manifest');
});

test('Python loads from the site first, and the engine catalog falls back to the published copy', () => {
  const origin = 'https://matheusprat.es/atlas-sfn/';
  assert.deepEqual(pyodideIndexes(manifest, origin), [new URL(`/pyodide/v${manifest.pyodide.version}/full/`, origin).href, manifest.pyodide.indexURL]);
  const revision = 'a'.repeat(32);
  const [shared, published] = engineBases(`/api/shared/data/${revision}/`, 'http://localhost/');
  assert.equal(shared, `http://localhost/api/shared/data/${revision}/statements/engine/`);
  assert.equal(published, 'http://localhost/data/statements/engine/');
  assert.deepEqual(engineBases('/data/', 'http://localhost/'), ['http://localhost/data/statements/engine/']);
});
