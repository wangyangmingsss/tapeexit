import { describe, it, expect } from 'vitest';
import { decodeFunctionData, encodeFunctionData, getAddress, maxUint128 } from 'viem';
import { managerAbi, WOKB } from '../src/config';
import { isExcludedAsset } from '../src/core/asset-policy';
import { makePlan, parseTokenId, validatePlan } from '../src/core/protocol';
import { StrictRpc, type Requester } from '../src/core/rpc';
import { demoSnapshot, DEMO_OWNER } from '../src/demo/engine';
import { importRecoveryCard, recoveryCard } from '../src/core/storage';
import { TickMath } from '@uniswap/v3-sdk';
const sources = [{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }];
describe('strict independent reads', () => {
  it('requires two operators, not two domains', () => {
    expect(() => new StrictRpc(sources.map(s => ({ ...s, operator: 'same' })))).toThrow('independent');
  });
  it('accepts matching data', async () => {
    const rpc = new StrictRpc(sources, async () => '0xAB');
    expect(await rpc.request('eth_call', [])).toBe('0xAB');
  });
  it('rejects conflicting data', async () => {
    const rpc = new StrictRpc(sources, async s => s.operator === 'a' ? '0x01' : '0x02');
    await expect(rpc.request('eth_call', [])).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('does not substitute zero after failure', async () => {
    const rpc = new StrictRpc(sources, async s => { if (s.operator === 'b') throw new Error('offline'); return '0x0'; });
    await expect(rpc.request('eth_call', [])).rejects.toMatchObject({ code: 'QUORUM' });
  });
  it('does not hide a dissenting third source', async () => {
    const rpc = new StrictRpc([...sources, { url: 'https://c.example', operator: 'c' }], async s => s.operator === 'c' ? '0x2' : '0x1');
    await expect(rpc.request('eth_call', [])).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('ignores object order, never a meaningful field', async () => {
    const request: Requester = async s => s.operator === 'a' ? { hash: '0xAA', number: '0x01' } : { number: '0x01', hash: '0xaa' };
    await expect(new StrictRpc(sources, request).request('block', [])).resolves.toBeTruthy();
  });
});
describe('position parsing and safe plans', () => {
  it('excludes WOKB in either position leg even when metadata claims verification', async () => {
    const snapshot = await demoSnapshot(1n, 'none');
    for (const key of ['token0', 'token1'] as const) {
      const excluded = { ...snapshot, [key]: { ...snapshot[key], address: WOKB, verified: true } };
      for (const collectOnly of [false, true])
        expect(() => makePlan(excluded, DEMO_OWNER, 100, 50, collectOnly))
          .toThrow('excludes WOKB');
      const existing = makePlan(snapshot, DEMO_OWNER, 100, 50);
      expect(() => validatePlan({ ...existing, snapshot: excluded })).toThrow('excludes WOKB');
    }
    expect(isExcludedAsset(WOKB.toLowerCase() as typeof WOKB)).toBe(true);
    expect(isExcludedAsset(WOKB, 1)).toBe(false);
  });
  it('handles the entire uint256 range exactly', () => {
    expect(parseTokenId((2n ** 256n - 1n).toString())).toBe(2n ** 256n - 1n);
    for (const text of ['-1', '1.1', '01', '1e3', (2n ** 256n).toString()])
      expect(() => parseTokenId(text)).toThrow();
  });
  it('uses manager-owned multicall and current recipient', async () => {
    const s = await demoSnapshot(1n, 'none');
    const p = makePlan(s, DEMO_OWNER, 10000, 50);
    const d = decodeFunctionData({ abi: managerAbi, data: p.data });
    expect(d.functionName).toBe('multicall');
    if (d.functionName !== 'multicall') throw new Error();
    expect(d.args[0]).toHaveLength(2);
    expect(p.liquidity).toBe(s.liquidity);
    expect(p.amount0Min).toBeGreaterThan(0n);
    expect(p.amount1Min).toBeGreaterThan(0n);
    expect(p.value).toBe(0n);
    expect(() => validatePlan(p)).not.toThrow();
  });
  it('rejects recipient or method tampering', async () => {
    const s = await demoSnapshot(1n, 'none');
    const p = makePlan(s, DEMO_OWNER, 5000, 50);
    expect(() => validatePlan({ ...p, recipient: getAddress('0x0000000000000000000000000000000000000002') })).toThrow();
    const data = encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{ tokenId: 2n, recipient: DEMO_OWNER, amount0Max: maxUint128, amount1Max: maxUint128 }] });
    expect(() => validatePlan({ ...p, data })).toThrow();
  });
  it('restricts trading to direct owners and reviewed assets', async () => {
    const s = await demoSnapshot(1n, 'none');
    expect(() => makePlan(s, getAddress('0x0000000000000000000000000000000000000002'), 10000, 50)).toThrow();
    expect(() => makePlan({ ...s, token0: { ...s.token0, verified: false } }, DEMO_OWNER, 10000, 50)).toThrow();
  });
  it('collect-only has no fictitious contract deadline', async () => {
    const s = await demoSnapshot(1n, 'none');
    const p = makePlan({ ...s, liquidity: 0n }, DEMO_OWNER, 10000, 50, true);
    expect(p.deadline).toBeNull();
    expect(p.liquidity).toBe(0n);
    expect(decodeFunctionData({ abi: managerAbi, data: p.data }).functionName).toBe('collect');
  });
  it('rejects invalid slippage and dust', async () => {
    const s = await demoSnapshot(1n, 'none');
    for (const slip of [0, -1, 301, 0.5]) expect(() => makePlan(s, DEMO_OWNER, 10000, slip)).toThrow();
    expect(() => makePlan({ ...s, liquidity: 1n }, DEMO_OWNER, 1, 50)).toThrow();
  });
  it('recomputes minimums and protects nested snapshot values', async () => {
    const s = await demoSnapshot(1n, 'none');
    const p = makePlan(s, DEMO_OWNER, 10000, 50);
    expect(() => validatePlan({ ...p, slippageBps: 300 })).toThrow();
    expect(() => validatePlan({ ...p, releaseId: 'other' })).toThrow();
    expect(Object.isFrozen(p.snapshot.token0)).toBe(true);
    s.liquidity = 0n;
    expect(() => validatePlan(p)).not.toThrow();
  });
  it('never removes more liquidity than requested', async () => {
    const s = await demoSnapshot(1n, 'none');
    for (const bps of [1, 17, 2500, 5000, 7500, 9999, 10000]) {
      const p = makePlan(s, DEMO_OWNER, bps, 50);
      expect(p.liquidity).toBe(s.liquidity * BigInt(bps) / 10000n);
      expect(p.liquidity).toBeLessThanOrEqual(s.liquidity);
    }
  });
  it('handles 6/8/18 decimal metadata and single-sided ranges', async () => {
    const s = await demoSnapshot(1n, 'none');
    for (const decimals of [6, 8, 18]) {
      const p = makePlan({ ...s, token0: { ...s.token0, decimals } }, DEMO_OWNER, 10000, 50);
      expect(p.amount0Min).toBeGreaterThan(0n);
    }
    const above = makePlan({ ...s, tick: 1200, sqrtPriceX96: BigInt(TickMath.getSqrtRatioAtTick(1200).toString()) }, DEMO_OWNER, 10000, 50);
    expect(above.amount0Min).toBe(0n);
    expect(above.amount1Min).toBeGreaterThan(0n);
  });
});
describe('recovery input boundary', () => {
  it('imports only public identity hints', () => {
    expect(importRecoveryCard(JSON.stringify(recoveryCard('12'))).tokenIds).toEqual(['12']);
  });
  it('rejects injected recipient, calldata and prototype fields', () => {
    for (const key of ['recipient', 'calldata', '__proto__']) {
      const text = JSON.stringify(recoveryCard('12')).slice(0, -1) + `, "${key}":"evil"}`;
      expect(() => importRecoveryCard(text)).toThrow();
    }
  });
  it('rejects recovery IDs exceeding uint256', () => {
    expect(() => importRecoveryCard(JSON.stringify({
      ...recoveryCard('12'), tokenIds: [(2n ** 256n).toString()],
    }))).toThrow();
  });
});
