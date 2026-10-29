import { encodeFunctionData, decodeFunctionResult, maxUint128, maxUint256, type Hex } from 'viem';
import { managerAbi, tokenAbi, type Deployment } from '../src/config';
import { V3Adapter } from '../src/core/adapter';
import { makePlan } from '../src/core/protocol';
import { inspectReceipt } from '../src/core/receipt';
import { StrictRpc } from '../src/core/rpc';
import { inspectForkOwner } from './fork-owner';

type LocalRequest = (method: string, params?: unknown[]) => Promise<any>;
// The CLI supplies only the private IPC transport of its disposable Anvil child.
export async function runAssetForkMatrix(request: LocalRequest, rpc: StrictRpc, deployment: Deployment, tokenId: bigint) {
  const reader = new V3Adapter(rpc, deployment);
  const initial = await reader.snapshot(tokenId);
  if (!initial.liquidity) throw new Error('A nonempty directly owned position is required');
  const ownerAccount = await inspectForkOwner(rpc, initial.owner, initial.block);
  const adapter = new V3Adapter(rpc, deployment, [initial.token0.address, initial.token1.address]);
  await request('anvil_setBalance', [initial.owner, '0x8ac7230489e80000']);
  await request('anvil_impersonateAccount', [initial.owner]);
  async function mine() { await request('evm_mine'); await request('evm_mine'); await request('evm_mine'); }
  async function balances() {
    return Promise.all([initial.token0, initial.token1].map(async token => {
      const data = await rpc.request<Hex>('eth_call', [{ to: token.address, data: encodeFunctionData({
        abi: tokenAbi, functionName: 'balanceOf', args: [initial.owner],
      }) }, 'latest']);
      return decodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', data });
    }));
  }
  async function execute(data: Hex, gas: bigint) {
    const hash = await request('eth_sendTransaction', [{ from: initial.owner, to: deployment.manager,
      data, value: '0x0', gas: `0x${gas.toString(16)}` }]) as Hex;
    if (!/^0x[a-f0-9]{64}$/i.test(hash)) throw new Error('Unknown local submission');
    for (let attempt = 0; attempt < 20; attempt++) {
      const receipt = await request('eth_getTransactionReceipt', [hash]);
      if (receipt) return { hash, receipt };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Local receipt unavailable; no resubmission');
  }
  const results = [];
  for (const scenario of ['partial', 'full', 'collect-with-liquidity', 'collect-without-liquidity', 'minimum-revert', 'deadline-revert']) {
    const checkpoint = await request('evm_snapshot');
    try {
      const collectOnly = scenario.startsWith('collect');
      if (collectOnly) {
        const block = await rpc.pin();
        const prepared = await execute(encodeFunctionData({ abi: managerAbi, functionName: 'decreaseLiquidity', args: [{
          tokenId, liquidity: scenario === 'collect-without-liquidity' ? initial.liquidity : initial.liquidity / 2n,
          amount0Min: 0n, amount1Min: 0n, deadline: BigInt(block.timestamp) + 300n,
        }] }), 2_000_000n);
        if (prepared.receipt.status !== '0x1') throw new Error('Collect preparation reverted');
        await mine();
      }
      const snapshot = await adapter.snapshot(tokenId);
      const before = await balances();
      const reverting = scenario.endsWith('revert');
      const plan = makePlan(snapshot, initial.owner, scenario === 'full' ? 10000 : 5000, 50, collectOnly, deployment);
      let data = plan.data, gas: bigint;
      if (reverting) {
        data = encodeFunctionData({ abi: managerAbi, functionName: 'multicall', args: [[
          encodeFunctionData({ abi: managerAbi, functionName: 'decreaseLiquidity', args: [{
            tokenId, liquidity: plan.liquidity, amount0Min: scenario === 'minimum-revert' ? maxUint256 : 0n,
            amount1Min: 0n, deadline: scenario === 'deadline-revert' ?
              BigInt(snapshot.block.timestamp) - 1n : BigInt(snapshot.block.timestamp) + 300n,
          }] }),
          encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
            tokenId, recipient: initial.owner, amount0Max: maxUint128, amount1Max: maxUint128,
          }] }),
        ]] });
        gas = 2_000_000n;
      } else gas = (await adapter.simulate(plan)).gas;
      const { hash, receipt } = await execute(data, gas);
      const after = await balances();
      await mine();
      const remaining = await adapter.snapshot(tokenId);
      if (remaining.owner !== initial.owner) throw new Error('NFT owner changed');
      const deltas = after.map((balance, index) => balance - before[index]);
      if (reverting) {
        if (receipt.status !== '0x0' || receipt.logs.length || deltas.some(delta => delta !== 0n) ||
            remaining.liquidity !== snapshot.liquidity || remaining.owed0 !== snapshot.owed0 ||
            remaining.owed1 !== snapshot.owed1) throw new Error('Failed operation was not atomic');
      } else {
        const evidence = await inspectReceipt(rpc, hash, plan);
        if (receipt.status !== '0x1' || evidence?.state !== 'received-checked' ||
            deltas[0] !== BigInt(evidence.amount0) || deltas[1] !== BigInt(evidence.amount1) ||
            remaining.liquidity !== snapshot.liquidity - plan.liquidity ||
            remaining.owed0 !== 0n || remaining.owed1 !== 0n)
          throw new Error('Actual transfer, collection or remaining position mismatch');
      }
      results.push({ scenario, status: 'LOCAL_FORK_CASE_PASSED', hash, balanceDeltas: deltas.map(String),
        remainingLiquidity: remaining.liquidity.toString(), transactionStatus: receipt.status,
        gasUsed: BigInt(receipt.gasUsed).toString() });
    } finally {
      if (await request('evm_revert', [checkpoint]) !== true) throw new Error('Failed to restore isolated case');
    }
  }
  return { tokenId: tokenId.toString(), owner: initial.owner, ownerAccount,
    assets: [initial.token0, initial.token1].map(({ verified: _verified, ...asset }) => ({
      ...asset, approval: 'NOT_APPROVED',
    })), results };
}
