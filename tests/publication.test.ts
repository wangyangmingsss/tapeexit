import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { StrictRpc, type Requester } from '../src/core/rpc';
import { BINDING, digest, REGISTRY, type PublishFile } from '../tools/publish-core';
import { registryReadAbi, verifyPublication } from '../tools/verify-publication-core';

const container = '0x0000000000000000000000000000000000000001';
const sources = [{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }];
function publication(extra = 0) {
  const contents = Array.from({ length: extra + 2 }, (_, i) => {
    const bytes = Buffer.alloc(i === 0 ? 24001 : 0, 7);
    const file: PublishFile = { path: i === 0 ? 'index.html' : i === 1 ? 'release-manifest.json' : `asset-${i}.js`,
      size: bytes.length, sha256: digest(bytes), contentType: 'application/octet-stream' };
    return { file, bytes };
  });
  return { contents, manifestSha256: contents[1].file.sha256 };
}
type Fault = 'metadata' | 'bytes' | 'short' | 'extra' | 'duplicate' | 'page' | 'fallback' |
  'conflict' | 'reorg' | 'offline' | 'chain' | 'code' | 'missing';
function fixture(fault?: Fault, extra = 0) {
  const local = publication(extra);
  const timestamp = `0x${Math.floor(Date.now() / 1000).toString(16)}`;
  let blockReads = 0;
  const calls: { operator: string; method: string; params: unknown[] }[] = [];
  const request: Requester = async (source, method, params) => {
    calls.push({ operator: source.operator, method, params });
    if (fault === 'offline' && source.operator === 'b') throw new Error('offline');
    if (method === 'eth_chainId') return fault === 'chain' ? '0x1' : '0xc4';
    if (method === 'eth_blockNumber') return '0x102';
    if (method === 'eth_getBlockByNumber') {
      blockReads++;
      return { number: '0x100', timestamp,
        hash: `0x${(fault === 'reorg' && blockReads > 2 ? 'bb' : 'aa').repeat(32)}` };
    }
    if (method === 'eth_getCode') return fault === 'code' ? '0x' : '0x6000';
    if (method !== 'eth_call') throw new Error(`Unexpected write or method ${method}`);
    const tx = params[0] as { to: string; data: Hex };
    const decoded = decodeFunctionData({ abi: registryReadAbi, data: tx.data });
    expect(params[1]).toBe('0x100');
    expect(tx.to).toBe(decoded.functionName === 'isContainerLive' ? BINDING : REGISTRY);
    expect(decoded.args[0]).toBe(container);
    let result: unknown;
    if (decoded.functionName === 'pathCount') result = BigInt(local.contents.length + (fault === 'extra' ? 1 : 0));
    if (decoded.functionName === 'pathsRange') {
      const start = Number(decoded.args[1]), count = Number(decoded.args[2]);
      const paths = local.contents.slice(start, start + count).map(({ file }) => file.path);
      result = fault === 'duplicate' ? paths.map(() => 'index.html') :
        fault === 'page' ? paths.slice(1) : paths;
    }
    if (decoded.functionName === 'fallbackPath') result = fault === 'fallback' ? 'wrong.html' : 'index.html';
    if (decoded.functionName === 'isContainerLive') result = false;
    if (decoded.functionName === 'fileInfo' || decoded.functionName === 'readRange') {
      const item = local.contents.find(({ file }) => file.path === decoded.args[1])!;
      if (decoded.functionName === 'fileInfo') {
        result = [BigInt(item.file.size), fault === 'metadata' ? 'text/plain' : item.file.contentType,
          `0x${item.file.sha256}`, 1n, fault === 'missing' ? 0n : 2n];
      } else {
        const offset = Number(decoded.args[2]), count = Number(decoded.args[3]);
        let bytes = Buffer.from(item.bytes.subarray(offset, offset + count));
        if (fault === 'short') bytes = bytes.subarray(1);
        if (fault === 'bytes' || (fault === 'conflict' && source.operator === 'b')) bytes.fill(8);
        result = `0x${bytes.toString('hex')}`;
      }
    }
    return encodeFunctionResult({ abi: registryReadAbi, functionName: decoded.functionName, result } as
      Parameters<typeof encodeFunctionResult>[0]);
  };
  return { local, calls, rpc: new StrictRpc(sources, request) };
}
describe('published release readback at a fixed block', () => {
  it('compares every byte from two sources and does not imply activation', async () => {
    const { rpc, local, calls } = fixture();
    const report = await verifyPublication(rpc, container, local, local.manifestSha256);
    expect(report).toMatchObject({ status: 'published-bytes-checked', containerLive: false,
      totalBytes: 24001, fallback: 'index.html' });
    expect(report.files).toHaveLength(2);
    expect(new Set(calls.map(call => call.operator))).toEqual(new Set(['a', 'b']));
    expect(calls.filter(call => call.method === 'eth_call').every(call => call.params[1] === '0x100')).toBe(true);
    expect(calls.filter(call => call.method === 'eth_call' &&
      decodeFunctionData({ abi: registryReadAbi, data: (call.params[0] as { data: Hex }).data })
        .functionName === 'readRange')).toHaveLength(4);
  });
  it('enumerates the full path list across page boundaries', async () => {
    const { rpc, local } = fixture(undefined, 201);
    expect((await verifyPublication(rpc, container, local, local.manifestSha256)).files).toHaveLength(203);
  });
  it.each<Fault>(['metadata', 'bytes', 'short', 'extra', 'duplicate', 'page', 'fallback',
    'conflict', 'reorg', 'offline', 'chain', 'code', 'missing'])('fails closed for %s', async fault => {
    const { rpc, local } = fixture(fault);
    await expect(verifyPublication(rpc, container, local, local.manifestSha256)).rejects.toThrow();
  });
  it('rejects untrusted manifest and altered local bytes before network access', async () => {
    const { rpc, local, calls } = fixture();
    await expect(verifyPublication(rpc, container, local, '0'.repeat(64))).rejects.toThrow('digest');
    local.contents[0].bytes[0] = 9;
    await expect(verifyPublication(rpc, container, local, local.manifestSha256)).rejects.toThrow('Local');
    expect(calls).toHaveLength(0);
  });
});
