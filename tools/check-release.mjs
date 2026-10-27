import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
async function collect(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e =>
    e.isDirectory() ? collect(resolve(dir, e.name)) : [resolve(dir, e.name)]))).flat();
}
for (const path of await collect('dist')) {
  if (path.endsWith('.map') || /demo|mock/i.test(path)) throw new Error(`Development file in production: ${path}`);
  if (!/\.(js|html|css)$/.test(path)) continue;
  const text = await readFile(path, 'utf8');
  if (/github_pat_|ghp_[A-Za-z0-9]{20}|BEGIN PRIVATE KEY/.test(text)) throw new Error('Credential-like content detected');
  if (/TEST-USDC|TEST-USDT|demoExecute|simulated-a/.test(text)) throw new Error('Demo engine in production bundle');
  if (/<script[^>]+src=["']https?:/i.test(text) || /@import\s+url\(["']?https?:/i.test(text))
    throw new Error('Remote executable dependency');
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (!pkg.dependencies || Object.values(pkg.dependencies).some(v => /^[~^*]/.test(v))) throw new Error('Runtime dependencies must be exact-pinned');
const config = await readFile('src/config.ts', 'utf8');
if (!/export const RELEASE_APPROVED = false;/.test(config))
  throw new Error('This development release pipeline requires signing disabled; review and replace the release gate explicitly before production approval.');
console.log('Production isolation, credential patterns, external scripts, and exact runtime pins checked.');
