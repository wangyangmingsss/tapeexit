import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
execFileSync(process.execPath, ['tools/vendor-tapekit.mjs', ...process.argv.slice(2)], { stdio: 'inherit' });
await rm('dist-gateway', { recursive: true, force: true });
await mkdir('dist-gateway/.tape/kernel', { recursive: true });
for (const name of ['index.html', 'sw.js']) await cp(`vendor/tapekit/sw-gateway/${name}`, `dist-gateway/${name}`);
await cp('vendor/tapekit/LICENSE', 'dist-gateway/TAPEKIT-LICENSE.txt');
for (const name of ['boot.js', 'pages.js', 'serve.js', 'policy.html', 'config.json', 'blocklist.txt'])
  await cp(`vendor/tapekit/sw-gateway/${name}`, `dist-gateway/.tape/${name}`);
for (const name of await readdir('vendor/tapekit/kernel/src'))
  if (name.endsWith('.js')) await cp(`vendor/tapekit/kernel/src/${name}`, `dist-gateway/.tape/kernel/${name}`);
const path = 'dist-gateway/.tape/serve.js';
const source = await readFile(path, 'utf8');
const begin = source.indexOf('export const SITE_CSP = [');
const end = source.indexOf("].join('; ');", begin);
if (begin < 0 || end < 0) throw new Error('Pinned upstream CSP structure changed');
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://rpc.xlayer.tech https://xlayer.drpc.org; worker-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'; report-uri /.tape/csp-report";
const output = source.slice(0, begin) + `export const SITE_CSP = ${JSON.stringify(policy)};` + source.slice(end + "].join('; ');".length);
await writeFile(path, output);
await writeFile('dist-gateway/tapeexit-gateway.json', JSON.stringify({
  upstreamCommit: '37c617e7e332787c8a32a81e4d7d05a28a06c156',
  policy, serveSha256: createHash('sha256').update(output).digest('hex'),
  scope: 'Dedicated TapeExit gateway; upstream reserved routes and verification are preserved',
}, null, 2) + '\n');
console.log('Dedicated TapeExit gateway built. Hosting, TLS and actual container verification are separate release steps.');
