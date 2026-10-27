import { describe, expect, it } from 'vitest';
import { encodeFunctionData, maxUint128 } from 'viem';
import { DEPLOYMENT, managerAbi } from '../src/config';
import { historicalExitToken, recheckHistory } from '../src/core/history';
import { makePlan } from '../src/core/protocol';
import { StrictRpc } from '../src/core/rpc';
import { demoSnapshot, DEMO_OWNER } from '../src/demo/engine';

const sources = [{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }];
const item = { tokenId: '12', hash: `0x${'ab'.repeat(32)}`, time: new Date().toISOString(),
  environment: 'mainnet' as const, state: 'submitted' };
describe('historical direct exit verification', () => {
  it('decodes only supported direct exits to the sender', async () => {
    const snapshot = await demoSnapshot(12n, 'none');
    for (const collectOnly of [false, true]) {
      const plan = makePlan(snapshot, DEMO_OWNER, 5000, 50, collectOnly);
      expect(historicalExitToken(plan.data, DEMO_OWNER)).toBe(12n);
    }
    const collect = encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
      tokenId: 12n, recipient: DEMO_OWNER, amount0Max: maxUint128, amount1Max: maxUint128,
    }] });
    expect(() => historicalExitToken(collect, '0x0000000000000000000000000000000000000001')).toThrow();
    expect(() => historicalExitToken(encodeFunctionData({ abi: managerAbi,
      functionName: 'ownerOf', args: [12n] }), DEMO_OWNER)).toThrow();
    expect(() => historicalExitToken(encodeFunctionData({ abi: managerAbi,
      functionName: 'multicall', args: [[collect, collect]] }), DEMO_OWNER)).toThrow();
  });
  it('returns pending using read-only methods when no receipt exists', async () => {
    const methods: string[] = [];
    const rpc = new StrictRpc(sources, async (_source, method) => {
      methods.push(method);
      if (method === 'eth_chainId') return '0xc4';
      if (method === 'eth_getTransactionReceipt') return null;
      throw new Error(`Unexpected ${method}`);
    });
    await expect(recheckHistory(rpc, item)).resolves.toEqual({ state: 'pending' });
    expect(new Set(methods)).toEqual(new Set(['eth_chainId', 'eth_getTransactionReceipt']));
    await expect(recheckHistory(rpc, { ...item, environment: 'demo' })).rejects.toMatchObject({ code: 'HISTORY' });
  });
  it('rejects wrong chains and unrelated receipt targets', async () => {
    const wrongChain = new StrictRpc(sources, async () => '0x1');
    await expect(recheckHistory(wrongChain, item)).rejects.toThrow();
    const rpc = new StrictRpc(sources, async (_source, method) => method === 'eth_chainId' ? '0xc4' : {
      status: '0x1', blockNumber: '0x1', blockHash: item.hash, transactionHash: item.hash,
      from: DEMO_OWNER, to: '0x0000000000000000000000000000000000000001',
    });
    expect(DEPLOYMENT.chainId).toBe(196);
    await expect(recheckHistory(rpc, item)).rejects.toMatchObject({ code: 'HISTORY' });
  });
});
