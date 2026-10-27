import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFunctionData } from 'viem';
import { digest, preparePublication, publishAbi } from '../tools/publish-core.ts';
import { resolvePath } from '../vendor/tapekit/kernel/src/path.js';

test('generated registry paths resolve in the pinned TapeKit client', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tapeexit-tapekit-paths-'));
  try {
    const content = [
      ['index.html', '<html><script src="./assets/app.js"></script></html>', 'text/html'],
      ['assets/app.js', 'console.log("test")', 'text/javascript'],
    ];
    await mkdir(join(root, 'assets'));
    const files = [];
    for (const [path, source, contentType] of content) {
      const bytes = Buffer.from(source);
      await writeFile(join(root, path), bytes);
      files.push({ path, contentType, size: bytes.length, sha256: digest(bytes) });
    }
    await writeFile(join(root, 'release-manifest.json'), JSON.stringify({
      app: 'TapeExit', schemaVersion: 1, chainId: 196, signingApproved: false,
      sourceCommit: 'a'.repeat(40), sourceDirty: false, files,
    }));
    const plan = await preparePublication(root, '0x0000000000000000000000000000000000000001');
    const calls = plan.transactions.map(tx => decodeFunctionData({ abi: publishAbi, data: tx.data }));
    const paths = new Set(calls.filter(call => call.functionName === 'putFile').map(call => call.args[1]));
    const fallback = calls.find(call => call.functionName === 'setFallback').args[1];
    assert.equal(resolvePath('/', paths, fallback), 'index.html');
    assert.equal(resolvePath('/assets/app.js', paths, fallback), 'assets/app.js');
    assert.equal(resolvePath('/release-manifest.json', paths, fallback), 'release-manifest.json');
    assert.equal(resolvePath('/some/route', paths, fallback), 'index.html');
    assert.equal(resolvePath('/missing.png', paths, fallback), null);
    assert.equal(fallback, 'index.html');
    // The previous leading-slash upload format is incompatible with this client.
    const oldPaths = new Set([...paths].map(path => '/' + path));
    assert.equal(resolvePath('/', oldPaths, '/index.html'), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
