import { describe, expect, it } from 'vitest';
import { decodeFunctionData, zeroAddress } from 'viem';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, encodePublishFile, fallbackTransaction, publishAbi, REGISTRY,
  validatePublishManifest, preparePublication } from '../tools/publish-core';
const container = '0x0000000000000000000000000000000000000001';
const file = { path: 'index.html', contentType: 'text/html; charset=utf-8', size: 0, sha256: digest(new Uint8Array()) };
const manifest = { app: 'TapeExit', schemaVersion: 1, chainId: 196, signingApproved: false,
  sourceDirty: false, sourceCommit: 'a'.repeat(40), files: [file] };
describe('unsigned publication boundaries', () => {
  it('requires committed manifest and rejects unsafe/duplicate/reserved declarations', () => {
    expect(validatePublishManifest(manifest)).toEqual([file]);
    for (const path of ['../index.html', '/index.html', 'a//b', '.tape/x', '.tape', 'sw.js', 'release-manifest.json']) {
      expect(() => validatePublishManifest({ ...manifest, files: [{ ...file, path }] })).toThrow();
    }
    for (const patch of [{ sourceDirty: true }, { sourceCommit: 'uncommitted' }, { files: [file, file] },
      { signingApproved: true }, { files: [{ ...file, size: -1 }] },
      { files: [{ ...file, size: 8_400_001 }] },
      { files: [{ ...file, contentType: 'text/html\r\ninjected' }] }]) {
      expect(() => validatePublishManifest({ ...manifest, ...patch })).toThrow();
    }
  });
  it('encodes exact 0/24000/24001-byte boundaries and sequential append indices', () => {
    for (const size of [0, 24000, 24001, 48001]) {
      const bytes = new Uint8Array(size).fill(7);
      const transactions = encodePublishFile(container, { ...file, size, sha256: digest(bytes) }, bytes);
      expect(transactions).toHaveLength(Math.max(1, Math.ceil(size / 24000)));
      const restored: string[] = [];
      transactions.forEach((tx, i) => {
        expect(tx).toMatchObject({ to: REGISTRY, value: '0', chunk: i });
        const call = decodeFunctionData({ abi: publishAbi, data: tx.data });
        expect(call.args[0]).toBe(container);
        expect(call.args[1]).toBe('index.html');
        if (call.functionName === 'putFile') {
          expect(i).toBe(0);
          expect(call.args[3]).toBe(`0x${digest(bytes)}`);
          restored.push(call.args[4].slice(2));
        } else if (call.functionName === 'appendChunk') {
          expect(call.args[2]).toBe(BigInt(i));
          restored.push(call.args[3].slice(2));
        } else throw new Error('Unexpected fallback');
      });
      expect(restored.join('')).toBe(Buffer.from(bytes).toString('hex'));
    }
  });
  it('rejects changed bytes and zero container and pins fallback target', () => {
    expect(() => encodePublishFile(container, file, new Uint8Array([1]))).toThrow('mismatch');
    expect(() => encodePublishFile(container, { ...file, size: 1 }, new Uint8Array([1]))).toThrow('mismatch');
    expect(() => encodePublishFile(zeroAddress, file, new Uint8Array())).toThrow('Zero');
    const tx = fallbackTransaction(container);
    expect(tx).toMatchObject({ to: REGISTRY, value: '0' });
    expect(decodeFunctionData({ abi: publishAbi, data: tx.data })).toMatchObject({
      functionName: 'setFallback', args: [container, 'index.html'],
    });
  });
  it('prepares a complete release with index and fallback last and rejects extra files/links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tapeexit-publication-'));
    try {
      const bytes = Buffer.alloc(24001, 7);
      const asset = { path: 'app.js', size: bytes.length, sha256: digest(bytes), contentType: 'text/javascript' };
      await writeFile(join(root, 'index.html'), '');
      await writeFile(join(root, 'app.js'), bytes);
      const manifestBytes = Buffer.from(JSON.stringify({ ...manifest, files: [file, asset] }));
      await writeFile(join(root, 'release-manifest.json'), manifestBytes);
      const plan = await preparePublication(root, container);
      expect(plan.manifestSha256).toBe(digest(manifestBytes));
      expect(plan.transactions.map(tx => tx.file)).toEqual([
        'app.js', 'app.js', 'release-manifest.json', 'index.html', '(fallback)',
      ]);
      await writeFile(join(root, 'stale.js'), 'old');
      await expect(preparePublication(root, container)).rejects.toThrow('Undeclared');
      await rm(join(root, 'stale.js'));
      await rm(join(root, 'app.js'));
      await symlink(join(root, 'index.html'), join(root, 'app.js'));
      await expect(preparePublication(root, container)).rejects.toThrow('link');
      await rm(join(root, 'app.js'));
      await expect(preparePublication(root, container)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
