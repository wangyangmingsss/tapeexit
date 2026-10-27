import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { StrictRpc, type Requester } from '../src/core/rpc';
import { digest } from '../tools/publish-core';
import { resumePublication } from '../tools/resume-publication-core';
import { registryReadAbi } from '../tools/verify-publication-core';

const container = '0x1000000000000000000000000000000000000001';
function fixture(mode: 'empty' | 'partial' | 'complete' = 'partial', fault = '') {
  const contents = ['app.js', 'release-manifest.json', 'index.html'].map((path, i) => {
    const bytes = Buffer.alloc(i === 0 ? 48001 : 0, 7);
    return { file: { path, size: bytes.length, sha256: digest(bytes), contentType: 'application/octet-stream' }, bytes };
  });
  const local = { contents, manifestSha256: contents[1].file.sha256 };
  const existing = mode === 'empty' ? [] : mode === 'complete' ? contents : contents.slice(0, 1);
  const methods: string[] = [];
  let blockReads = 0;
  const request: Requester = async (source, method, params) => {
    methods.push(method);
    if (fault === 'offline' && source.operator === 'b') throw new Error('unavailable');
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_blockNumber') return '0xa';
    if (method === 'eth_getBlockByNumber') return { number: '0x8',
      hash: `0x${fault === 'reorg' && ++blockReads > 2 ? 'bb'.repeat(32) : 'aa'.repeat(32)}`,
      timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
    if (method === 'eth_getCode') return '0x6000';
    if (method !== 'eth_call') throw new Error('Unexpected write');
    const decoded = decodeFunctionData({ abi: registryReadAbi, data: (params[0] as { data: Hex }).data });
    expect(params[1]).toBe('0x8');
    let result: unknown;
    if (decoded.functionName === 'pathCount') result = BigInt(existing.length);
    if (decoded.functionName === 'pathsRange') result = existing.map((c, i) =>
      fault === 'path' ? 'unknown.js' : fault === 'duplicate' && i ? existing[0].file.path : c.file.path);
    if (decoded.functionName === 'fallbackPath') result = mode === 'complete' && fault !== 'fallback' ? 'index.html' : '';
    if (decoded.functionName === 'fileInfo') {
      const file = contents.find(c => c.file.path === decoded.args[1])!.file;
      const size = mode === 'partial' ? (fault === 'boundary' ? 24001 : 24000) : file.size;
      result = [BigInt(size), file.contentType, fault === 'metadata' ? `0x${'00'.repeat(32)}` : `0x${file.sha256}`,
        1n, BigInt(mode === 'partial' ? 1 : Math.max(1, Math.ceil(file.size / 24000)))];
    }
    if (decoded.functionName === 'readRange') {
      const item = contents.find(c => c.file.path === decoded.args[1])!;
      let part = Buffer.from(item.bytes.subarray(Number(decoded.args[2]), Number(decoded.args[2]) + Number(decoded.args[3])));
      if (fault === 'short') part = part.subarray(1);
      if (fault === 'bytes' || fault === 'conflict' && source.operator === 'b') part.fill(9);
      result = `0x${part.toString('hex')}`;
    }
    return encodeFunctionResult({ abi: registryReadAbi, functionName: decoded.functionName, result } as
      Parameters<typeof encodeFunctionResult>[0]);
  };
  return { local, methods, rpc: new StrictRpc([{ url: 'https://a.example', operator: 'a' },
    { url: 'https://b.example', operator: 'b' }], request) };
}
describe('publication resume without blind replay', () => {
  it('only keeps missing original chunks after exact prefix verification', async () => {
    const { rpc, local, methods } = fixture();
    const plan = await resumePublication(rpc, container, local);
    expect(plan.checked).toEqual([{ path: 'app.js', existingChunks: '1', existingBytes: '24000', complete: false }]);
    expect(plan.transactions.map(tx => [tx.file, tx.chunk])).toEqual([
      ['app.js', 1], ['app.js', 2], ['release-manifest.json', 0], ['index.html', 0], ['(fallback)', 0],
    ]);
    expect(methods.some(m => /send|sign/i.test(m))).toBe(false);
  });
  it('produces a full plan for an empty registry and no calls for already matching complete files', async () => {
    const empty = fixture('empty'), complete = fixture('complete');
    expect((await resumePublication(empty.rpc, container, empty.local)).transactionCount).toBe(6);
    expect((await resumePublication(complete.rpc, container, complete.local)).transactionCount).toBe(0);
    const fallback = fixture('complete', 'fallback');
    expect((await resumePublication(fallback.rpc, container, fallback.local)).transactions.map(tx => tx.file)).toEqual(['(fallback)']);
  });
  it.each(['path', 'metadata', 'boundary', 'short', 'bytes', 'conflict', 'offline', 'reorg'])(
    'rejects %s rather than overwriting or continuing', async fault => {
      const { rpc, local } = fixture('partial', fault);
      await expect(resumePublication(rpc, container, local)).rejects.toThrow();
    });
  it('rejects duplicate existing paths and altered local content', async () => {
    const duplicate = fixture('complete', 'duplicate');
    await expect(resumePublication(duplicate.rpc, container, duplicate.local)).rejects.toThrow('duplicate');
    const changed = fixture();
    changed.local.contents[0].bytes[0] = 0;
    await expect(resumePublication(changed.rpc, container, changed.local)).rejects.toThrow('Local');
    expect(changed.methods).toEqual([]);
  });
});
