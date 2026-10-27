import { getAddress, type Address, type Hex } from 'viem';
import type { Snapshot, Plan, Preview } from '../core/protocol';
import { ExitError } from '../core/rpc';
import type { Result } from '../core/receipt';

export const DEMO_OWNER = getAddress('0x1000000000000000000000000000000000000001');
const A = getAddress('0x2000000000000000000000000000000000000001');
const B = getAddress('0x3000000000000000000000000000000000000001');
export type Fault = 'none' | 'conflict' | 'unavailable';
export async function demoSnapshot(tokenId: bigint, fault: Fault): Promise<Snapshot> {
  await new Promise(r => setTimeout(r, 450));
  if (fault === 'conflict') throw new ExitError('CONFLICT', 'RPC responses disagree; signing stopped');
  if (fault === 'unavailable') throw new ExitError('QUORUM', 'Independent RPC responses unavailable; signing stopped');
  return { tokenId, owner: DEMO_OWNER, pool: getAddress('0x4000000000000000000000000000000000000001'),
    token0: { address: A, symbol: 'TEST-USDC', decimals: 6, verified: true },
    token1: { address: B, symbol: 'TEST-USDT', decimals: 6, verified: true },
    fee: 3000, tickLower: -600, tickUpper: 600, liquidity: 50000000000n,
    sqrtPriceX96: 2n ** 96n, tick: 0, poolLiquidity: 500000000000n, owed0: 12000000n, owed1: 8500000n,
    block: { number: '0x246f123', hash: `0x${'ab'.repeat(32)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` },
  };
}
export async function demoPreview(plan: Plan, fault: Fault): Promise<Preview> {
  await new Promise(r => setTimeout(r, 400));
  if (fault !== 'none') throw new ExitError('CONFLICT', 'Fault injected; signing stopped');
  return { amount0: plan.amount0Min + plan.snapshot.owed0, amount1: plan.amount1Min + plan.snapshot.owed1, gas: 240000n, gasPrice: 1000000n };
}
export async function demoExecute(plan: Plan, preview: Preview): Promise<Result> {
  await new Promise(r => setTimeout(r, 700));
  return { hash: `0x${'de'.repeat(32)}` as Hex, blockNumber: BigInt(plan.snapshot.block.number).toString(),
    blockHash: plan.snapshot.block.hash, amount0: preview.amount0.toString(), amount1: preview.amount1.toString(),
    state: 'received-checked', safe: false, finalized: false };
}
export type DemoEngine = {
  DEMO_OWNER: Address; demoSnapshot: typeof demoSnapshot; demoPreview: typeof demoPreview; demoExecute: typeof demoExecute;
};
