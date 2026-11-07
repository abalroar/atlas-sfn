import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker, { createWorker } from '../worker/index.js';

const origin = 'https://matheusprat.es';
const noAssets = { ASSETS: { fetch() { throw Error('API or redirect reached static assets'); } } };

test('app entry and legacy entry retain institution, filters and fragment', async () => {
  const query = '?view=institutions&bank=5f6d3c0745685d8f&periods=202509%2C202606&panel=data#capital';
  for (const path of ['/', '/atlas-sfn', '/tomaconta', '/tomaconta/']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await worker.fetch(new Request(origin + path + query, { method }), noAssets);
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('Location'), origin + '/atlas-sfn/' + query);
      assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    }
  }
});

test('static assets map the public prefix to the independent build root', async () => {
  for (const [path, internal] of [
    ['/atlas-sfn/', '/index.html'],
    ['/atlas-sfn/?bank=itau', '/index.html?bank=itau'],
    ['/atlas-sfn/index.html', '/index.html'],
    ['/atlas-sfn/assets/index-123.js', '/assets/index-123.js'],
    ['/atlas-sfn/data/atlas-pj.json', '/data/atlas-pj.json'],
    ['/atlas-sfn/data/statements/inputs/individual-00000000.json.gz', '/data/statements/inputs/individual-00000000.json.gz'],
  ]) {
    let seen;
    const response = await worker.fetch(new Request(origin + path, { headers: { 'If-None-Match': 'hash' } }), {
      ASSETS: { fetch(request) { seen = request; return new Response('asset', { headers: { ETag: 'hash' } }); } },
    });
    assert.equal(response.status, 200);
    assert.equal(seen.url, origin + internal);
    assert.equal(seen.headers.get('If-None-Match'), 'hash');
    assert.equal(response.headers.get('ETag'), 'hash');
    assert.equal(await response.text(), 'asset');
  }
});

test('HEAD preserves the asset request method and metadata without response bytes', async () => {
  let seen;
  const response = await worker.fetch(new Request(origin + '/atlas-sfn/data/sfn.json', { method: 'HEAD' }), {
    ASSETS: { fetch(request) { seen = request; return new Response('asset', { headers: { 'Content-Length': '5', ETag: 'hash' } }); } },
  });
  assert.equal(seen.method, 'HEAD');
  assert.equal(response.headers.get('Content-Length'), '5');
  assert.equal(await response.text(), '');
});

test('both shared API names preserve request method, headers and JSON body', async () => {
  const app = createWorker({ shared: async (request, env) => {
    assert.equal(env.marker, true);
    assert.equal(request.url, origin + '/tomaconta/api/shared/jobs?check=1');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('Origin'), origin);
    assert.equal(request.headers.get('Idempotency-Key'), 'abc');
    assert.deepEqual(await request.json(), { kind: 'mercado_imobiliario' });
    return Response.json({ id: 'job' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } });
  for (const prefix of ['/atlas-sfn/api/shared', '/tomaconta/api/shared']) {
    const response = await app.fetch(new Request(origin + prefix + '/jobs?check=1', {
      method: 'POST', headers: { Origin: origin, 'Idempotency-Key': 'abc', 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'mercado_imobiliario' }),
    }), { marker: true });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { id: 'job' });
  }
});

test('original shared service remains accessible in unconfigured static mode', async () => {
  for (const prefix of ['/atlas-sfn/api/shared', '/tomaconta/api/shared']) {
    const response = await worker.fetch(new Request(origin + prefix + '/current'), noAssets);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revision: null, builtIn: true, configured: false });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('BCB proxy retains the original canonical URL and HEAD has no body', async () => {
  const app = createWorker({ proxy: async url => {
    assert.equal(url.href, origin + '/tomaconta/api/bcb?source=sgs&code=20542');
    return Response.json([{ valor: '1' }], { headers: { 'Cache-Control': 'public, max-age=60' } });
  } });
  for (const prefix of ['/atlas-sfn/api', '/tomaconta/api']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await app.fetch(new Request(origin + prefix + '/bcb?source=sgs&code=20542', { method }), noAssets);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
      if (method === 'HEAD') assert.equal(await response.text(), '');
      else assert.deepEqual(await response.json(), [{ valor: '1' }]);
    }
    const invalid = await worker.fetch(new Request(origin + prefix + '/bcb?source=unknown'), noAssets);
    assert.equal(invalid.status, 400);
    assert.match(invalid.headers.get('Content-Type'), /application\/json/);
  }
});

test('unsupported API and asset methods do not reach handlers or static files', async () => {
  for (const path of ['/atlas-sfn/', '/atlas-sfn/data/sfn.json', '/atlas-sfn/api/bcb', '/tomaconta/']) {
    const response = await worker.fetch(new Request(origin + path, { method: 'POST' }), noAssets);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('unknown APIs and personal-site routes remain outside this Worker', async () => {
  for (const path of ['/atlas-sfn/api/unknown', '/tomaconta/api/unknown', '/admin', '/api/admin/photos', '/media/photo.jpg', '/data/sfn.json', '/assets/index.js']) {
    const response = await worker.fetch(new Request(origin + path), noAssets);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('encoded separators cannot change the internal asset path', async () => {
  for (const path of ['/atlas-sfn/%2fadmin', '/atlas-sfn/data%5csfn.json', '/atlas-sfn/data/%00sfn.json']) {
    assert.equal((await worker.fetch(new Request(origin + path), noAssets)).status, 404);
  }
});

test('HTML and baseline data revalidate while hashed frontend assets are immutable', async () => {
  for (const [path, type, expected] of [
    ['/atlas-sfn/', 'text/html', 'public, max-age=0, must-revalidate'],
    ['/atlas-sfn/data/sfn.json', 'application/json', 'public, max-age=0, must-revalidate'],
    ['/atlas-sfn/assets/index-123.js', 'application/javascript', 'public, max-age=31536000, immutable'],
  ]) {
    const response = await worker.fetch(new Request(origin + path), { ASSETS: { fetch() { return new Response('asset', { headers: { 'Content-Type': type } }); } } });
    assert.equal(response.headers.get('Cache-Control'), expected);
    assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(response.headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  }
});

test('independent configuration contains only financial bindings and no domain routes', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'atlas-sfn');
  assert.equal(config.assets.directory, './web/dist');
  assert.equal(config.assets.html_handling, 'none');
  assert.equal(config.assets.run_worker_first, true);
  assert.deepEqual(config.d1_databases.map(item => item.binding), ['TOMACONTA_DB']);
  assert.deepEqual(config.r2_buckets.map(item => item.binding), ['TOMACONTA_BUCKET']);
  assert.equal(config.routes, undefined);
  assert.equal(config.route, undefined);
});
