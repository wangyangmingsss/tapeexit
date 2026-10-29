import { expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { digest, publishAbi } from '../tools/publish-core';
import { registryReadAbi } from '../tools/verify-publication-core';
import { resumePublicationUpdate, updateRemovals } from '../tools/resume-publication-update';

const container = '0x1000000000000000000000000000000000000001';
const file = (path: string, text: string) => {
  const bytes = Buffer.from(text);
  return { file: { path, size: bytes.length, sha256: digest(bytes), contentType: 'text/plain' }, bytes };
};
function fixture(fault = '') {
  const oldFiles = [file('obsolete.js', 'old script'), file('release-manifest.json', 'old manifest'), file('index.html', 'old html')];
  const nextFiles = [file('new.js', 'new script'), file('release-manifest.json', 'new manifest'), file('index.html', 'new html')];
  const previous = { contents: oldFiles, manifestSha256: oldFiles[1].file.sha256 };
  const next = { contents: nextFiles, manifestSha256: nextFiles[1].file.sha256 };
  const stored = new Map(oldFiles.map(f => [f.file.path, f]));
  let reorg = false;
  const methods: string[] = [];
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }],
    async (_source, method, params) => {
      methods.push(method);
      if (method === 'eth_chainId') return '0xc4';
      if (method === 'eth_blockNumber') return '0x12';
      if (method === 'eth_getBlockByNumber') return { number: '0x10', hash: `0x${reorg ? 'cd' : 'ab'}`.padEnd(66, '0'),
        timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
      if (method === 'eth_getCode') return '0x6000';
      if (method !== 'eth_call') throw new Error('Unexpected method');
      const d = decodeFunctionData({ abi: registryReadAbi, data: (params[0] as any).data });
      let result: unknown;
      if (d.functionName === 'pathCount') result = BigInt(stored.size);
      if (d.functionName === 'pathsRange') result = [...stored.keys()];
      if (d.functionName === 'fallbackPath') result = 'index.html';
      if (d.functionName === 'fileInfo') {
        const f = stored.get(d.args[1])!;
        result = [BigInt(f.file.size), f.file.contentType, `0x${fault === 'hash' ? '00'.repeat(32) : f.file.sha256}`, 1n, 1n];
      }
      if (d.functionName === 'readRange') {
        const f = stored.get(d.args[1])!;
        result = `0x${(fault === 'bytes' ? Buffer.alloc(f.bytes.length) : f.bytes).toString('hex')}`;
        if (fault === 'reorg') reorg = true;
      }
      return encodeFunctionResult({ abi: registryReadAbi, functionName: d.functionName, result } as any);
    });
  return { rpc, previous, next, stored, methods };
}
it('only plans removals of fully checked old bytes; no signing or overwrite occurs', async () => {
  const f = fixture();
  const result = await resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256);
  expect(result.transactions.map(op => decodeFunctionData({ abi: publishAbi, data: op.data }).functionName))
    .toEqual(['removeFile', 'removeFile', 'removeFile']);
  expect(f.methods.some(m => /send|sign/i.test(m))).toBe(false);
});
it('resumes after removal without deleting already uploaded new bytes', async () => {
  const f = fixture(); f.stored.clear();
  f.stored.set('index.html', f.next.contents[2]);
  const result = await resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256);
  expect(result.transactions.every(op => op.chunk >= 0)).toBe(true);
  expect(result.transactions.map(op => op.file)).toEqual(['new.js', 'release-manifest.json', '(fallback)']);
});
it.each(['hash', 'bytes', 'reorg'])('stops on changed old evidence: %s', async fault => {
  const f = fixture(fault);
  await expect(resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256)).rejects.toThrow();
});
it('rejects unknown paths and an untrusted previous release', async () => {
  const f = fixture();
  f.stored.set('foreign.js', file('foreign.js', 'unrelated'));
  await expect(resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256)).rejects.toThrow('Unknown');
  await expect(resumePublicationUpdate(f.rpc, container, f.next, f.previous, 'ab'.repeat(32))).rejects.toThrow('digest');
  expect(updateRemovals(container, f.next, f.previous)).toHaveLength(3);
});
