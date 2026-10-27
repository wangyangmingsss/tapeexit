import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]))).flat();
}
let commit = 'uncommitted';
let sourceDirty = true;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  sourceDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
} catch { /* Initial development release. */ }
const list = [];
for (const path of (await files(root)).sort()) {
  const bytes = await readFile(path);
  list.push({ path: relative(root, path).replaceAll('\\', '/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), contentType: mime[extname(path)] || 'application/octet-stream' });
}
const manifest = { schemaVersion: 1, app: 'TapeExit', version: '0.1.0', sourceCommit: commit, sourceDirty,
  tapekitCommit: '37c617e7e332787c8a32a81e4d7d05a28a06c156',
  chainId: 196, signingApproved: false, files: list };
await writeFile(resolve(root, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await rm('recovery/dist', { recursive: true, force: true });
await mkdir('recovery/tools', { recursive: true });
await cp('dist', 'recovery/dist', { recursive: true });
await cp('tools/local-server.mjs', 'recovery/tools/local-server.mjs');
await cp('tools/verify-bundle.mjs', 'recovery/tools/verify-bundle.mjs');
await cp('LICENSE', 'recovery/LICENSE');
await writeFile('recovery/README.txt', 'TapeExit recovery bundle\n\nRequires Node.js 22.12 or newer.\n1. Verify this bundle against a previously saved manifest SHA-256.\n2. Run: node tools/verify-bundle.mjs <previously-saved-sha256>\n3. Run: node tools/local-server.mjs\n4. Open http://localhost:4173\n\nMainnet signing is disabled until release review is complete.\nLocal code still requires network RPC and a functioning chain.\n');
console.log(`Release: ${list.length} files, ${list.reduce((n, f) => n + f.size, 0)} raw bytes; recovery bundle created.`);
