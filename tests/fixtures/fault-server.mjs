import http from 'node:http';
import { createLocalServer } from '../../tools/local-server.mjs';

// Test-only HTTP redirect origin. Recovery and gateway distributions never include this file.
const upstream = await createLocalServer('dist', 4182);
const server = http.createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:4181') { res.writeHead(403); res.end(); return; }
  const redirectManifest = req.url === '/release-manifest.json' && req.headers['x-fixture-redirect'] === '1';
  if (redirectManifest || req.url === '/bounded-redirect') {
    res.writeHead(redirectManifest ? 307 : 302, {
      location: redirectManifest ? '/redirected-manifest' : '/bounded-target',
      'cache-control': 'no-store', 'content-length': '0',
    });
    res.end(); return;
  }
  const proxy = http.request({ hostname: '127.0.0.1', port: 4182, path: req.url,
    method: req.method, headers: { ...req.headers, host: '127.0.0.1:4182' } }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  proxy.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(proxy);
});
await new Promise(resolve => server.listen(4181, '127.0.0.1', resolve));
function close() { server.close(); upstream.close(); }
process.once('SIGTERM', close); process.once('SIGINT', close);
