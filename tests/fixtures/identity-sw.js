// Synthetic identity responses for lifecycle tests; this is not the TapeKit worker.
const version = new URL(self.location.href).searchParams.get('v');
const container = `0x${(version === '2' ? '22' : '11').repeat(20)}`;
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data === 'probe-primary') event.waitUntil(
    fetch('https://primary.example/proxy-probe', { signal: AbortSignal.timeout(5000) })
      .then(() => event.ports[0].postMessage('unexpected-response'),
        () => event.ports[0].postMessage('blocked')),
  );
});
self.addEventListener('fetch', event => {
  const path = new URL(event.request.url).pathname;
  if (path === '/.tape/status') event.respondWith(Response.json({
    name: 'fixture-2-1', chainId: 196, container, block: '16', status: 'ok',
  }));
  if (path === '/index.html') event.respondWith(new Response('Synthetic fixture entry', { headers: {
    'content-type': 'text/html', 'x-tape-mode': 'client', 'x-tape-status': 'ok',
    'x-tape-name': 'fixture-2-1', 'x-tape-container': container, 'x-tape-verified': '1',
  } }));
});
