import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
describe('recovery bundle verification', () => {
  let root: string, digest: string;
  const verifier = resolve('tools/verify-bundle.mjs');
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'tapeexit-bundle-'));
    await mkdir(join(root, 'dist'));
    const source = '<h1>Known application</h1>';
    await writeFile(join(root, 'dist/index.html'), source);
    const manifest = JSON.stringify({ app: 'TapeExit', schemaVersion: 1, files: [{
      path: 'index.html', size: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex'),
    }] });
    digest = createHash('sha256').update(manifest).digest('hex');
    await writeFile(join(root, 'dist/release-manifest.json'), manifest);
  });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  function check(hash = digest) {
    return execFileSync(process.execPath, [verifier, hash], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  it('checks bytes against a separately supplied digest', () => {
    expect(check()).toContain('Verified 1 files');
    expect(() => check('0'.repeat(64))).toThrow();
  });
  it('rejects extra files left by mixed releases', async () => {
    await writeFile(join(root, 'dist/old-chunk.js'), 'stale');
    expect(() => check()).toThrow();
    await rm(join(root, 'dist/old-chunk.js'));
  });
  it('rejects altered application bytes', async () => {
    await writeFile(join(root, 'dist/index.html'), '<h1>Changed</h1>');
    expect(() => check()).toThrow();
  });
});
