import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, keccak256, zeroAddress, type Abi, type Hex } from 'viem';
import { StrictRpc, type Requester } from '../src/core/rpc';
import { tokenAbi } from '../src/config';
import { BINDING, REGISTRY, encodePublishFile, digest } from '../tools/publish-core';
import { decodeStorageAddress, identityAbi, IMPLEMENTATIONS, IMPL_SLOT, OPENER, TAPE_FACTORY,
  inspectAssets, inspectPublication, parsePublishProfile } from '../tools/operations-core';

const publisher = '0x1000000000000000000000000000000000000001';
const container = '0x2000000000000000000000000000000000000002';
const processor = '0x3000000000000000000000000000000000000003';
const code: Hex = '0x6000';
const codeHash = keccak256(code);
const block = { number: '0x8', hash: `0x${'ab'.repeat(32)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
const profile = { schemaVersion: 1, chainId: 196, publisher, container, circuitId: '1', processorIndex: '2',
  maxGasPerTransaction: '1000000', maxFeePerGasWei: '100', maxUploadCostWei: '100000000',
  expectedCodeHashes: Object.fromEntries(['processor', 'container', 'opener', 'registry', 'binding', 'factory'].map(k => [k, codeHash])) };
const transactions = encodePublishFile(container, { path: 'index.html', size: 0,
  sha256: digest(Buffer.alloc(0)), contentType: 'text/html' }, Buffer.alloc(0));
const word = (a: string) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}` as Hex;
function fixture(changes: Record<string, unknown> = {}) {
  const methods: string[] = [];
  const request: Requester = async (_source, method, params) => {
    methods.push(method);
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_blockNumber') return '0xa';
    if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_getCode') return changes.code ?? code;
    if (method === 'eth_getStorageAt') {
      if (changes.slot) return changes.slot;
      const names = new Map([[REGISTRY, 'registry'], [BINDING, 'binding'], [TAPE_FACTORY, 'factory']]);
      const name = names.get(params[0] as never) as keyof typeof IMPLEMENTATIONS | undefined;
      return name && params[1] === IMPL_SLOT ? word(IMPLEMENTATIONS[name]) : word(zeroAddress);
    }
    if (method === 'eth_call') {
      const tx = params[0] as { to: string; data: Hex };
      if (tx.to === REGISTRY) {
        if (changes.simulationRevert) throw new Error('Listed or locked');
        return '0x';
      }
      const abi: Abi = tx.to === container ? identityAbi : tx.to === publisher ? tokenAbi : identityAbi;
      const call = decodeFunctionData({ abi, data: tx.data });
      const values: Record<string, unknown> = { cpuAt: processor, isCPU: true, accountOf: container,
        isOpened: true, ownerOf: publisher, token: [196n, processor, 1n], monthlyFee: 10n, isContainerLive: false,
        decimals: 6, symbol: 'CANDIDATE', ...changes };
      if (!(call.functionName in values)) throw new Error('Unexpected call');
      return encodeFunctionResult({ abi, functionName: call.functionName, result: values[call.functionName] });
    }
    throw new Error(`Unexpected RPC ${method}`);
  };
  return { rpc: new StrictRpc([{ url: 'http://localhost:1', operator: 'a' },
    { url: 'http://localhost:1', operator: 'b' }], request), methods };
}
describe('read-only operational preflight', () => {
  it('binds container, publisher, implementation pins and an explicit bounded upload cost', async () => {
    const { rpc, methods } = fixture();
    const report = await inspectPublication(rpc, profile, transactions);
    expect(report).toMatchObject({ status: 'identity-checked-unsigned', container,
      maximumUploadCostWei: '100000000', monthlyActivationFeeWei: '10', containerLive: false });
    expect(methods.some(m => /send|sign/i.test(m))).toBe(false);
    expect(report.scope).toContain('first operation simulation only');
  });
  it('rejects missing identity, placeholder hashes, wrong chain and ambiguous budgets before RPC', () => {
    for (const patch of [{ publisher: null }, { container: zeroAddress }, { chainId: 1 },
      { maxUploadCostWei: '1.2' }, { maxFeePerGasWei: '-1' }, { circuitId: '-1' },
      { processorIndex: '1000000001' }, { expectedCodeHashes: { ...profile.expectedCodeHashes, opener: null } }])
      expect(() => parsePublishProfile({ ...profile, ...patch })).toThrow();
  });
  it('stops on owner, opening, derived identity, token identity or implementation disagreement', async () => {
    for (const changes of [{ ownerOf: processor }, { isOpened: false }, { accountOf: processor },
      { token: [1n, processor, 1n] }, { isCPU: false }, { slot: word(publisher) }])
      await expect(inspectPublication(fixture(changes).rpc, profile, transactions)).rejects.toThrow();
  });
  it('does not clear listing/lock or silently exceed the budget', async () => {
    await expect(inspectPublication(fixture({ simulationRevert: true }).rpc, profile, transactions)).rejects.toThrow();
    await expect(inspectPublication(fixture().rpc, { ...profile, maxUploadCostWei: '1' }, transactions))
      .rejects.toThrow('budget');
    await expect(inspectPublication(fixture().rpc, profile, [{ ...transactions[0], value: '1' as '0' }]))
      .rejects.toThrow('target or value');
    const wrong = encodePublishFile(processor, { path: 'index.html', size: 0,
      sha256: digest(Buffer.alloc(0)), contentType: 'text/html' }, Buffer.alloc(0));
    await expect(inspectPublication(fixture().rpc, profile, wrong)).rejects.toThrow('another container');
    await expect(inspectPublication(fixture().rpc, { ...profile, maxGasPerTransaction: '21000' }, transactions))
      .rejects.toThrow('intrinsic cost');
  });
  it('refuses changed or missing code rather than accepting only an address pin', async () => {
    await expect(inspectPublication(fixture({ code: '0x6001' }).rpc, profile, transactions)).rejects.toThrow('differs');
    await expect(inspectPublication(fixture({ code: '0x' }).rpc, profile, transactions)).rejects.toThrow('Missing');
  });
  it('collects token metadata without approving assets or treating empty slots as safety', async () => {
    const { rpc, methods } = fixture();
    const report = await inspectAssets(rpc, [publisher]);
    expect(report.assets[0]).toMatchObject({ address: publisher, decimals: 6, approval: 'NOT_APPROVED',
      behavior: 'NOT_ASSESSED', slots: { implementation: null, beacon: null } });
    expect(report.limitations.join(' ')).toContain('do not prove');
    expect(methods.some(m => /send|sign/i.test(m))).toBe(false);
  });
  it('rejects duplicate, zero, oversized or unsupported token candidates', async () => {
    for (const addresses of [[], [publisher, publisher], [zeroAddress], Array(21).fill(publisher)])
      await expect(inspectAssets(fixture().rpc, addresses)).rejects.toThrow();
    await expect(inspectAssets(fixture({ decimals: 37 }).rpc, [publisher])).rejects.toThrow('precision');
  });
  it('does not decode malformed implementation words into plausible addresses', () => {
    expect(decodeStorageAddress(word(zeroAddress))).toBeNull();
    expect(decodeStorageAddress(word(publisher))).toBe(publisher);
    for (const value of ['0x', `0x${'f'.repeat(64)}`, null, publisher])
      expect(() => decodeStorageAddress(value)).toThrow();
  });
});
