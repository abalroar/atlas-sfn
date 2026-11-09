import { bcbProxy } from '../web/server/bcb.js';
import { handleShared, SHARED_ROOT } from '../web/server/shared.js';

const APP_ROOT = '/atlas-sfn/';
const SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Atlas-Repository': 'abalroar/atlas-sfn',
};

export function withHeaders(response, request) {
  const headers = new Headers(response.headers);
  const pathname = new URL(request.url).pathname;
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (response.status >= 400) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  } else if (pathname.startsWith(`${APP_ROOT}assets/`) || (pathname.startsWith(`${APP_ROOT}pyodide/`) && !pathname.endsWith('/atlas-mirror.json'))) {
    // Pyodide servido pelo site: pasta com a versão no nome, conteúdo imutável.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (headers.get('Content-Type')?.includes('text/html') || pathname.startsWith(`${APP_ROOT}data/`) || pathname === `${APP_ROOT}build.json`) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function reject(status, message, headers) {
  return Response.json({ error: message }, { status, headers });
}

function destination(url, pathname) {
  const next = new URL(url);
  next.pathname = pathname;
  return next;
}

// Injecting the existing handlers keeps routing tests offline; production uses
// the original financial service and its existing OIDC identity contract.
export function createWorker({ proxy = bcbProxy, shared = handleShared } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const finish = response => withHeaders(response, request);

      for (const prefix of ['/atlas-sfn/api/shared/', `${SHARED_ROOT}/`]) {
        if (url.pathname.startsWith(prefix)) {
          const canonical = destination(url, `${SHARED_ROOT}/${url.pathname.slice(prefix.length)}`);
          return finish(await shared(new Request(canonical, request), env));
        }
      }

      if (!['GET', 'HEAD'].includes(request.method)) {
        return finish(reject(405, 'Método inválido.', { Allow: 'GET, HEAD' }));
      }

      if (url.pathname === '/atlas-sfn/api/bcb' || url.pathname === '/tomaconta/api/bcb') {
        return finish(await proxy(destination(url, '/tomaconta/api/bcb')));
      }
      if (url.pathname.startsWith('/atlas-sfn/api/') || url.pathname.startsWith('/tomaconta/api/')) {
        return finish(reject(404, 'Operação inexistente.'));
      }

      if (['/', '/atlas-sfn', '/tomaconta', '/tomaconta/'].includes(url.pathname)) {
        return finish(Response.redirect(destination(url, APP_ROOT).href, 308));
      }

      if (!url.pathname.startsWith(APP_ROOT)) return finish(reject(404, 'Página inexistente.'));

      const relative = url.pathname.slice(APP_ROOT.length);
      // Published asset names are plain ASCII. Encoded separators must not
      // escape the application's prefix when handed to the static binding.
      if (/%(?:2f|5c|00)/i.test(relative) || relative.split('/').some(part => part === '.' || part === '..')) {
        return finish(reject(404, 'Arquivo inexistente.'));
      }
      if (!env.ASSETS?.fetch) return finish(reject(503, 'Arquivos do Atlas indisponíveis.'));

      const assetUrl = destination(url, relative ? `/${relative}` : '/index.html');
      return finish(await env.ASSETS.fetch(new Request(assetUrl, request)));
    },
  };
}

export default createWorker();
