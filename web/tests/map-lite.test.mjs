import test from 'node:test';
import assert from 'node:assert/strict';
import {baseStyle, liteStyle, softwareRenderer, needsLite, LITE_SAMPLE, RELIEF_LAYERS} from '../src/territory/map-style.js';

const empty = {type: 'FeatureCollection', features: []};

test('the light map drops only the relief and its elevation source', () => {
  const full = baseStyle(empty, empty), lite = liteStyle(full);
  assert.ok(RELIEF_LAYERS.every(id => full.layers.some(layer => layer.id === id)));
  assert.deepEqual(lite.layers.map(layer => layer.id), full.layers.map(layer => layer.id).filter(id => !RELIEF_LAYERS.includes(id)));
  assert.equal(lite.sources.dem, undefined);
  assert.ok(lite.layers.every(layer => !layer.source || lite.sources[layer.source]), 'every remaining layer keeps its source');
  assert.ok(full.sources.dem, 'the full style is left untouched');
});

test('software renderers are recognised and hardware ones are not', () => {
  for (const name of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver', 'Google SwiftShader']) assert.ok(softwareRenderer(name), name);
  for (const name of ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Apple GPU', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4)', 'Adreno (TM) 610', '', undefined]) assert.ok(!softwareRenderer(name), String(name));
});

test('the film switches to the light map only after a full sample with a slow median frame', () => {
  assert.equal(needsLite(Array(LITE_SAMPLE - 1).fill(60)), false, 'too few frames');
  assert.equal(needsLite(Array(LITE_SAMPLE).fill(16.7)), false);
  const spiky = [...Array(LITE_SAMPLE - 10).fill(16.7), ...Array(10).fill(200)];
  assert.equal(needsLite(spiky), false, 'a few long frames (tile arrivals) do not count');
  assert.equal(needsLite(Array(LITE_SAMPLE).fill(33.4)), true, '30 fps');
});
