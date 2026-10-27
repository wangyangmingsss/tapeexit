import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://rpc.xlayer.tech https://xlayer.drpc.org; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'";
export async function createLocalServer(rootPath = resolve('dist'), port = 4173) {
  const root = await realpath(rootPath);
  const server = http.createServer(async (req, res) => {
    const reject = status => { res.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end(http.STATUS_CODES[status]); };
    const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
    if (!allowedHosts.has(req.headers.host)) return reject(403);
    if (!['GET', 'HEAD'].includes(req.method)) return reject(405);
    try {
      const raw = req.url.split('?')[0];
      const path = decodeURIComponent(raw);
      if (path.includes('\0') || path.includes('\\') || path.split('/').some(s => s === '..' || s === '.')) return reject(400);
      const requested = resolve(root, `.${path === '/' ? '/index.html' : path}`);
      if (!requested.startsWith(root + sep)) return reject(403);
      const actual = await realpath(requested);
      if (!actual.startsWith(root + sep) || !(await stat(actual)).isFile()) return reject(403);
      const bytes = await readFile(actual);
      res.writeHead(200, {
        'content-type': mime[extname(actual)] || 'application/octet-stream',
        'content-security-policy': csp, 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'cache-control': 'no-store', 'content-length': bytes.length,
        'x-frame-options': 'DENY',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { reject(404); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.TAPEEXIT_PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid TAPEEXIT_PORT');
  await createLocalServer(resolve(process.argv[2] || 'dist'), port);
  console.log(`TapeExit recovery: http://localhost:${port} (loopback only)`);
}
