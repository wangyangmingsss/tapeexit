import { readFile, realpath, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
const expected = process.argv[2];
if (!/^[a-f0-9]{64}$/i.test(expected || '')) throw new Error('Supply a previously saved manifest SHA-256, not a hash obtained only from this download.');
const root = await realpath(resolve('dist'));
const bytes = await readFile(resolve(root, 'release-manifest.json'));
const hash = createHash('sha256').update(bytes).digest('hex');
if (hash.toLowerCase() !== expected.toLowerCase()) throw new Error('Manifest hash mismatch');
const manifest = JSON.parse(bytes.toString());
if (manifest.app !== 'TapeExit' || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files))
  throw new Error('Invalid manifest');
const declared = new Set(['release-manifest.json']);
for (const file of manifest.files) {
  if (typeof file.path !== 'string' || file.path.startsWith('/') || !/^[\w./-]+$/.test(file.path) ||
      file.path.split('/').some(s => !s || s === '..' || s === '.') || declared.has(file.path))
    throw new Error('Invalid manifest path');
  declared.add(file.path);
  const path = await realpath(resolve(root, file.path));
  if (!path.startsWith(root + sep)) throw new Error('Unsafe path');
  const content = await readFile(path);
  if (content.length !== file.size || createHash('sha256').update(content).digest('hex') !== file.sha256)
    throw new Error(`File mismatch: ${file.path}`);
}
async function inspect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) await inspect(resolve(dir, entry.name), path + '/');
    else if (!entry.isFile() || !declared.has(path)) throw new Error(`Undeclared file or link: ${path}`);
  }
}
await inspect(root);
console.log(`Verified ${manifest.files.length} files against the supplied manifest digest.`);
