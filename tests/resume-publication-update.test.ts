import { expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { digest, publishAbi } from '../tools/publish-core';
import { registryReadAbi } from '../tools/verify-publication-core';
import { incrementalUpdateOperations, resumePublicationUpdate, updateRemovals } from '../tools/resume-publication-update';

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
      if (d.functionName === 'fallbackPath') result = fault === 'fallback' ? '' : 'index.html';
      if (d.functionName === 'fileInfo') {
        const f = stored.get(d.args[1])!;
        result = [BigInt(f.bytes.length), f.file.contentType, `0x${fault === 'hash' ? '00'.repeat(32) : f.file.sha256}`,
          1n, BigInt(Math.max(1, Math.ceil(f.bytes.length / 24000)))];
      }
      if (d.functionName === 'readRange') {
        const f = stored.get(d.args[1])!;
        result = `0x${(fault === 'bytes' ? Buffer.alloc(f.bytes.length) : f.bytes)
          .subarray(Number(d.args[2]), Number(d.args[2]) + Number(d.args[3])).toString('hex')}`;
        if (fault === 'reorg') reorg = true;
      }
      return encodeFunctionResult({ abi: registryReadAbi, functionName: d.functionName, result } as any);
    });
  return { rpc, previous, next, stored, methods };
}
it('removes obsolete paths, directly replaces changed same-path files and reuses the fallback', async () => {
  const f = fixture();
  const result = await resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256);
  expect(result.transactions.map(op => decodeFunctionData({ abi: publishAbi, data: op.data }).functionName))
    .toEqual(['removeFile', 'putFile', 'putFile', 'putFile']);
  expect(result.transactions.map(op => op.file))
    .toEqual(['obsolete.js', 'new.js', 'release-manifest.json', 'index.html']);
  expect(f.methods.some(m => /send|sign/i.test(m))).toBe(false);
});
it('resumes after removal without deleting already uploaded new bytes', async () => {
  const f = fixture(); f.stored.clear();
  f.stored.set('index.html', f.next.contents[2]);
  const result = await resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256);
  expect(result.transactions.every(op => op.chunk >= 0)).toBe(true);
  expect(result.transactions.map(op => op.file)).toEqual(['new.js', 'release-manifest.json']);
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
it('retains legacy operation identities while providing an incremental upper bound', () => {
  const f = fixture();
  expect(updateRemovals(container, f.next, f.previous).map(op => op.file))
    .toEqual(['obsolete.js', 'release-manifest.json', 'index.html']);
  expect(incrementalUpdateOperations(container, f.next, f.previous).map(op => op.file))
    .toEqual(['obsolete.js', 'new.js', 'release-manifest.json', 'index.html', '(fallback)']);
  expect(incrementalUpdateOperations(container, f.next, f.previous, false)).toHaveLength(4);
});
it('does not rewrite unchanged bytes and only sets a fallback when its current value differs', async () => {
  const f = fixture('fallback');
  f.stored.clear();
  for (const item of f.next.contents) f.stored.set(item.file.path, item);
  const plan = await resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256);
  expect(plan.transactions.map(op => op.file)).toEqual(['(fallback)']);
  expect(plan.checked.every(item => item.complete)).toBe(true);
  const complete = fixture();
  complete.stored.clear();
  for (const item of complete.next.contents) complete.stored.set(item.file.path, item);
  expect((await resumePublicationUpdate(complete.rpc, container, complete.next, complete.previous,
    complete.previous.manifestSha256)).transactionCount).toBe(0);
});
it('resumes a verified new prefix at the exact original chunk boundary without rewriting it', async () => {
  const f = fixture(), bytes = Buffer.alloc(48001, 7);
  const item = { file: { path: 'new.js', size: bytes.length, sha256: digest(bytes), contentType: 'text/plain' }, bytes };
  f.next.contents[0] = item;
  f.stored.delete('obsolete.js');
  f.stored.set('new.js', { file: item.file, bytes: bytes.subarray(0, 24000) });
  const plan = await resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256);
  expect(plan.transactions.map(op => [op.file, op.chunk])).toEqual([
    ['new.js', 1], ['new.js', 2], ['release-manifest.json', 0], ['index.html', 0],
  ]);
  f.stored.set('new.js', { file: item.file, bytes: bytes.subarray(0, 24001) });
  await expect(resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256))
    .rejects.toThrow('Unrecognized');
});
it('reuses exact unchanged files but still verifies their bytes before skipping them', async () => {
  const f = fixture(), shared = file('shared.js', 'unchanged script');
  f.previous.contents.push(shared); f.next.contents.push(shared); f.stored.set(shared.file.path, shared);
  expect(incrementalUpdateOperations(container, f.next, f.previous).some(op => op.file === shared.file.path)).toBe(false);
  let plan = await resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256);
  expect(plan.transactions.some(op => op.file === shared.file.path)).toBe(false);
  f.stored.set(shared.file.path, { file: shared.file, bytes: Buffer.from('unchanged scripx') });
  await expect(resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256))
    .rejects.toThrow('bytes differ');
});
it('completes a mixed migration one transaction at a time with no duplicate writes after restart', async () => {
  const f = fixture(), bytes = Buffer.alloc(48001, 7);
  f.next.contents[0] = {
    file: { path: 'new.js', size: bytes.length, sha256: digest(bytes), contentType: 'text/plain' }, bytes,
  };
  const shared = file('shared.txt', 'same bytes');
  f.previous.contents.unshift(shared); f.next.contents.unshift(shared); f.stored.set(shared.file.path, shared);
  const executed: string[] = [];
  for (let index = 0; index < 12; index++) {
    const plan = await resumePublicationUpdate(f.rpc, container, f.next, f.previous, f.previous.manifestSha256);
    if (!plan.transactionCount) break;
    expect(plan.transactionCount).toBe(6 - executed.length);
    const op = plan.transactions[0], call = decodeFunctionData({ abi: publishAbi, data: op.data });
    executed.push(`${op.file}:${op.chunk}`);
    if (call.functionName === 'removeFile') f.stored.delete(call.args[1]);
    else if (call.functionName === 'putFile') {
      const item = f.next.contents.find(item => item.file.path === op.file)!;
      f.stored.set(op.file, { file: item.file, bytes: Buffer.from(call.args[4].slice(2), 'hex') });
    } else if (call.functionName === 'appendChunk') {
      const stored = f.stored.get(op.file)!;
      expect(call.args[2]).toBe(BigInt(Math.ceil(stored.bytes.length / 24000)));
      f.stored.set(op.file, { file: stored.file,
        bytes: Buffer.concat([stored.bytes, Buffer.from(call.args[3].slice(2), 'hex')]) });
    } else throw new Error('Matching fallback must not be rewritten');
  }
  expect(executed).toEqual(['obsolete.js:-1', 'new.js:0', 'new.js:1', 'new.js:2',
    'release-manifest.json:0', 'index.html:0']);
  for (const item of f.next.contents) expect(f.stored.get(item.file.path)?.bytes).toEqual(item.bytes);
  expect((await resumePublicationUpdate(f.rpc, container, f.next, f.previous,
    f.previous.manifestSha256)).transactionCount).toBe(0);
  expect(f.methods.some(method => /send|sign/i.test(method))).toBe(false);
});
