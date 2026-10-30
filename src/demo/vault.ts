import type { Address } from 'viem';
import { SPARK_USDC } from '../core/vault-config';
import { vaultPlan, type VaultPlan, type VaultSnapshot } from '../core/vault-adapter';

export async function snapshot(owner: Address): Promise<VaultSnapshot> {
  return { protocolId: 'spark-spusdc', vault: SPARK_USDC.vault, asset: SPARK_USDC.asset, owner,
    shares: 50_000000n, assets: 51_000000n, maxRedeem: 50_000000n, maxWithdraw: 51_000000n,
    totalAssets: 1_000_000000n, liquidAssets: 500_000000n, decimals: 6,
    block: { number: '0x100', hash: `0x${'ab'.repeat(32)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` } };
}
export async function simulate(plan: VaultPlan) {
  const current = await snapshot(plan.owner);
  vaultPlan(current, plan.shares);
  return { assets: plan.shares * 102n / 100n, shares: plan.shares,
    remainingShares: current.shares - plan.shares, gas: 180_000n, gasPrice: 1_000_000n, block: plan.block };
}
