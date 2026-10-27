import http from 'node:http';
import { resolve, sep, extname } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export async function createGatewayServer(rootPath = 'dist-gateway', port = 8096) {
  const root = await realpath(resolve(rootPath));
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
  const server = http.createServer(async (req, res) => {
    const reject = code => { res.writeHead(code); res.end(); };
    const host = req.headers.host || '';
    if (!new RegExp(`^(?:localhost|127\\.0\\.0\\.1|[0-9]+-2-[0-9]+\\.localhost):${port}$`).test(host)) return reject(403);
    if (!['GET', 'HEAD'].includes(req.method)) return reject(405);
    try {
      const path = decodeURIComponent(req.url.split('?')[0]);
      if (!path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(p => p === '.' || p === '..')) return reject(400);
      const name = path === '/sw.js' || path.startsWith('/.tape/') ? path : '/index.html';
      const actual = await realpath(resolve(root, `.${name}`));
      if (!actual.startsWith(root + sep)) return reject(403);
      const bytes = await readFile(actual);
      res.writeHead(200, { 'content-type': types[extname(actual)] || 'application/octet-stream',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'service-worker-allowed': '/', 'x-frame-options': 'DENY' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { reject(404); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.TAPEEXIT_GATEWAY_PORT || 8096);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid gateway port');
  await createGatewayServer('dist-gateway', port);
  console.log(`TapeExit gateway bootstrap: http://localhost:${port}; site: http://<ID>-2-<processor>.localhost:${port}`);
}
