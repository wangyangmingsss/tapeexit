import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, getAddress, keccak256, parseAbi, zeroAddress,
  type Address, type Hex } from 'viem';
import { StrictRpc, type Requester } from '../src/core/rpc';
import { tokenAbi } from '../src/config';
import { inspectAssets } from '../tools/operations-core';
import { ADMIN_SLOT, BEACON_SLOT, IMPL_SLOT, inspectProxyIdentity } from '../tools/proxy-identity-core';
import { compareAssetIdentities, parseAssetBaseline } from '../tools/asset-identity-core';
import { digest } from '../tools/publish-core';

const root: Address = '0x1000000000000000000000000000000000000001';
const implementation: Address = '0x2000000000000000000000000000000000000002';
const beacon: Address = '0x3000000000000000000000000000000000000003';
const beaconLogic: Address = '0x4000000000000000000000000000000000000004';
const admin: Address = '0x5000000000000000000000000000000000000005';
const alternate: Address = '0x6000000000000000000000000000000000000006';
const block = { number: '0x8', hash: `0x${'ab'.repeat(32)}` as Hex,
  timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as Hex } as const;
const word = (a?: string) => `0x${'0'.repeat(24)}${(a ?? zeroAddress).slice(2)}` as Hex;
const beaconAbi = parseAbi(['function implementation() view returns (address)']);
interface Spec { implementation?: Address; beacon?: Address; admin?: Address; code?: Hex }
function fixture(nodes: Record<string, Spec> = { [root]: {} }, options: {
  resolved?: Address; callerDependent?: boolean; conflict?: boolean; malformed?: boolean;
} = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const request: Requester = async (source, method, params) => {
    calls.push({ method, params });
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_blockNumber') return '0xa';
    if (method === 'eth_getBlockByNumber') return block;
    const address = params[0] as string;
    const spec = typeof address === 'string' ? nodes[address.toLowerCase()] : undefined;
    if (method === 'eth_getCode') return options.conflict && source.operator === 'b' ? '0x6001' : spec?.code ?? (spec ? '0x6000' : '0x');
    if (method === 'eth_getStorageAt') {
      if (options.malformed) return `0x${'f'.repeat(64)}`;
      return word(params[1] === IMPL_SLOT ? spec?.implementation : params[1] === BEACON_SLOT ? spec?.beacon : spec?.admin);
    }
    if (method === 'eth_call') {
      const tx = params[0] as { to: Address; data: Hex; from?: Address };
      if (tx.to === beacon) return encodeFunctionResult({ abi: beaconAbi, functionName: 'implementation',
        result: options.callerDependent && tx.from === root ? alternate : options.resolved ?? implementation });
      const call = decodeFunctionData({ abi: tokenAbi, data: tx.data });
      return encodeFunctionResult({ abi: tokenAbi, functionName: call.functionName,
        result: call.functionName === 'decimals' ? 6 : 'CANDIDATE' });
    }
    throw new Error(`Unexpected read method ${method}`);
  };
  return { calls, rpc: new StrictRpc([{ url: 'https://a.example', operator: 'a' },
    { url: 'https://b.example', operator: 'b' }], request) };
}
describe('fixed-block proxy dependency observations', () => {
  it('records empty standard slots without claiming absence of proxy behavior', async () => {
    const { rpc, calls } = fixture();
    const report = await inspectProxyIdentity(rpc, root, block);
    expect(report.nodes).toEqual([{ address: root, codeHash: keccak256('0x6000'),
      slots: { implementation: null, beacon: null, admin: null }, adminCodeHash: null }]);
    expect(report.edges).toEqual([]);
    expect(report.scope).toContain('Empty slots do not rule out custom proxies');
    expect(calls.every(c => c.params.at(-1) === block.number)).toBe(true);
  });
  it('records implementation, admin address and admin contract code separately', async () => {
    const { rpc, calls } = fixture({ [root]: { implementation, admin }, [implementation]: {}, [admin]: { code: '0x6001' } });
    const report = await inspectProxyIdentity(rpc, root, block);
    expect(report.nodes.find(n => n.address === root)).toMatchObject({
      slots: { implementation, admin }, adminCodeHash: keccak256('0x6001'),
    });
    expect(report.edges).toEqual([{ from: root, to: implementation, kind: 'implementation-slot' }]);
    expect(calls.some(c => /send|sign|setStorage/i.test(c.method))).toBe(false);
  });
  it('allows an administrator with no runtime code without labelling governance safe', async () => {
    const { rpc } = fixture({ [root]: { implementation, admin }, [implementation]: {} });
    expect((await inspectProxyIdentity(rpc, root, block)).nodes[0].adminCodeHash).toBeNull();
  });
  it('resolves a proxied beacon and samples its implementation with two callers at the same block', async () => {
    const { rpc, calls } = fixture({ [root]: { beacon }, [beacon]: { implementation: beaconLogic },
      [beaconLogic]: {}, [implementation]: {} });
    const report = await inspectProxyIdentity(rpc, root, block);
    expect(report.nodes).toHaveLength(4);
    expect(report.edges).toContainEqual({ from: beacon, to: implementation, kind: 'beacon-return' });
    const samples = calls.filter(c => c.method === 'eth_call');
    expect(samples.map(c => (c.params[0] as { from: Address }).from)).toEqual([zeroAddress, zeroAddress, root, root]);
    expect(samples.every(c => c.params[1] === block.number)).toBe(true);
  });
  it('refuses caller-dependent and zero beacon results', async () => {
    const nodes = { [root]: { beacon }, [beacon]: {}, [implementation]: {}, [alternate]: {} };
    for (const options of [{ callerDependent: true }, { resolved: zeroAddress }])
      await expect(inspectProxyIdentity(fixture(nodes, options).rpc, root, block)).rejects.toThrow('caller-dependent');
  });
  it('refuses conflicting standard slots and missing implementation code', async () => {
    await expect(inspectProxyIdentity(fixture({ [root]: { implementation, beacon } }).rpc, root, block))
      .rejects.toThrow('Ambiguous');
    await expect(inspectProxyIdentity(fixture({ [root]: { implementation } }).rpc, root, block))
      .rejects.toThrow('missing');
  });
  it.each(['0x0', '0xzz', '0x' + 'ff'.repeat(262145)])('rejects malformed or oversized dependency code %#', async code => {
    await expect(inspectProxyIdentity(fixture({ [root]: { code: code as Hex } }).rpc, root, block))
      .rejects.toThrow('code');
  });
  it('rejects malformed slots and source disagreement', async () => {
    await expect(inspectProxyIdentity(fixture(undefined, { malformed: true }).rpc, root, block))
      .rejects.toThrow('Malformed');
    await expect(inspectProxyIdentity(fixture(undefined, { conflict: true }).rpc, root, block))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('stops cyclic observations and beacon self-reference', async () => {
    for (const nodes of [{ [root]: { implementation: root } },
      { [root]: { implementation }, [implementation]: { implementation: root } },
      { [root]: { beacon }, [beacon]: {} }]) {
      const resolved = nodes[beacon] ? root : implementation;
      await expect(inspectProxyIdentity(fixture(nodes, { resolved }).rpc, root, block)).rejects.toThrow(/Cycl/);
    }
  });
  it('limits nested dependency work instead of traversing arbitrary addresses', async () => {
    const addresses = Array.from({ length: 6 }, (_, i) => getAddress(`0x${String(i + 1).padStart(40, '0')}`));
    const nodes = Object.fromEntries(addresses.map((a, i) => [a, { implementation: addresses[i + 1] }]));
    const { rpc, calls } = fixture(nodes);
    await expect(inspectProxyIdentity(rpc, addresses[0], block)).rejects.toThrow('limit');
    expect(calls.filter(c => c.method === 'eth_getCode').length).toBeLessThanOrEqual(10);
  });
});
describe('asset baseline identity comparison', () => {
  async function report(resolved = implementation, adminAddress?: Address, adminCode?: Hex) {
    return inspectAssets(fixture({ [root]: { beacon, admin: adminAddress }, [beacon]: {},
      [implementation]: {}, [alternate]: { code: '0x6001' }, ...(adminCode ? { [admin]: { code: adminCode } } : {}),
    }, { resolved }).rpc, [root]);
  }
  it('accepts exact digest-bound baseline bytes and observes unchanged identity without approving', async () => {
    const first = await report(), bytes = Buffer.from(JSON.stringify(first));
    const baseline = parseAssetBaseline(bytes, digest(bytes));
    const result = compareAssetIdentities(baseline, await report());
    expect(result).toMatchObject({ status: 'OBSERVED_IDENTITY_UNCHANGED', differences: [], approval: 'NOT_APPROVED' });
  });
  it('detects beacon upgrades while the token runtime and metadata remain identical', async () => {
    const first = await report(), second = await report(alternate);
    expect(second.assets[0].codeHash).toBe(first.assets[0].codeHash);
    expect(compareAssetIdentities(first, second)).toMatchObject({ status: 'ASSET_IDENTITY_CHANGED',
      differences: [{ address: root, field: 'proxyIdentity' }] });
  });
  it('detects administrator address and administrator code changes', async () => {
    const first = await report();
    expect(compareAssetIdentities(first, await report(implementation, admin)).status).toBe('ASSET_IDENTITY_CHANGED');
    expect(compareAssetIdentities(await report(implementation, admin, '0x6000'),
      await report(implementation, admin, '0x6001')).status).toBe('ASSET_IDENTITY_CHANGED');
  });
  it('detects precision and symbol changes without treating identity equality as standard behavior', async () => {
    const first = await report();
    for (const field of ['decimals', 'symbol'] as const) {
      const changed = structuredClone(first);
      if (field === 'decimals') changed.assets[0].decimals = 18;
      else changed.assets[0].symbol = 'CHANGED';
      expect(compareAssetIdentities(first, changed).differences[0].field).toBe(field);
    }
  });
  it('rejects digest tampering, old reports lacking proxy observations and corrupted graph digest', async () => {
    const first = await report();
    const bytes = Buffer.from(JSON.stringify(first));
    expect(() => parseAssetBaseline(Buffer.concat([bytes, Buffer.from(' ')]), digest(bytes))).toThrow('digest');
    for (const patch of [{ proxy: undefined }, { proxy: { ...first.assets[0].proxy, identitySha256: 'a'.repeat(64) } }]) {
      const damaged = Buffer.from(JSON.stringify({ ...first, assets: [{ ...first.assets[0], ...patch }] }));
      expect(() => parseAssetBaseline(damaged, digest(damaged))).toThrow();
    }
  });
  it('rejects older observations, changed address sets, duplicate assets and changed canonical identity', async () => {
    const first = await report();
    for (const patch of [{ block: { ...block, number: '0x7' as Hex } },
      { block: { ...block, hash: `0x${'cd'.repeat(32)}` as Hex } }, { assets: [] },
      { assets: [first.assets[0], first.assets[0]] }, { chainId: 1 }]) {
      expect(() => compareAssetIdentities(first, { ...first, ...patch })).toThrow();
    }
  });
});
