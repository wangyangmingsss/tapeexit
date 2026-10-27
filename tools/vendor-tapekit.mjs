import { mkdir, mkdtemp, readFile, writeFile, readdir, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const commit = '37c617e7e332787c8a32a81e4d7d05a28a06c156';
const expected = '13c614ee91ce63d3c4273c5c61486cec4d17cf61dcfff439136b0813bc6faa06';
await mkdir('vendor', { recursive: true });
const temp = await mkdtemp(resolve('vendor/.tapekit-'));
try {
  const bytes = process.argv[2] ? await readFile(process.argv[2]) : await (async () => {
    const response = await fetch(`https://api.github.com/repos/TapeOutProtocol/TapeKit/tarball/${commit}`, {
      headers: { 'user-agent': 'TapeExit-build' }, signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`TapeKit download HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  })();
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('TapeKit archive hash mismatch; review upstream bytes before changing the pin');
  const archive = join(temp, 'source.tar.gz');
  await writeFile(archive, bytes);
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (listing.some(p => p.startsWith('/') || p.split('/').includes('..'))) throw new Error('Unsafe archive paths');
  const extracted = join(temp, 'source');
  await mkdir(extracted);
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', extracted]);
  async function tree(root, prefix = '') {
    const result = {};
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const path = join(prefix, entry.name);
      if (entry.isDirectory()) Object.assign(result, await tree(root, path));
      else if (entry.isFile()) result[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
      else throw new Error('Unexpected link in TapeKit archive');
    }
    return result;
  }
  let existing;
  try { existing = await tree('vendor/tapekit'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    const actual = await tree(extracted);
    const sorted = obj => JSON.stringify(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
    if (sorted(actual) !== sorted(existing)) throw new Error('Existing vendor tree differs; preserve and review it before reacquiring');
  } else await rename(extracted, 'vendor/tapekit');
  console.log(`TapeKit verified: ${commit}; archive SHA-256 ${expected}`);
} finally { await rm(temp, { recursive: true, force: true }); }
