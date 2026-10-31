import { getAddress } from 'viem';
import { importVaultRecovery, type VaultRecoveryTask } from '../src/core/vault-recovery';
import type { inspectVaultRecovery } from '../src/core/vault-recovery';

export interface VaultGatewayRecoveryTask {
  protocolId: 'spark-spusdc';
  recovery: VaultRecoveryTask;
  assets: string;
  shares: string;
  remainingShares: string;
}
const uint256 = /^(0|[1-9][0-9]*)$/;
function amount(value: unknown): value is string {
  return typeof value === 'string' && uint256.test(value) && value.length <= 78 &&
    BigInt(value) < 2n ** 256n;
}
export function parseVaultGatewayRecoveryTask(input: unknown): VaultGatewayRecoveryTask {
  const v = input as VaultGatewayRecoveryTask;
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
      Object.keys(v).sort().join(',') !== 'assets,protocolId,recovery,remainingShares,shares' ||
      v.protocolId !== 'spark-spusdc' || !amount(v.assets) || !amount(v.shares) ||
      !amount(v.remainingShares) || BigInt(v.assets) === 0n || BigInt(v.shares) === 0n ||
      !v.recovery || Object.keys(v.recovery).sort().join(',') !== 'account,chainId,hash,protocolId,schemaVersion,vault')
    throw new Error('Invalid read-only vault gateway task');
  return { ...v, recovery: importVaultRecovery(JSON.stringify(v.recovery)) };
}
export function assertVaultGatewayRecoveryTask(task: VaultGatewayRecoveryTask, input: unknown) {
  const o = input as Awaited<ReturnType<typeof inspectVaultRecovery>>;
  if (!o || o.state !== 'verified' || !('task' in o) ||
      o.task.schemaVersion !== 1 || o.task.protocolId !== task.protocolId || o.task.chainId !== 196 ||
      getAddress(o.task.vault) !== task.recovery.vault || getAddress(o.task.account) !== task.recovery.account ||
      o.task.hash !== task.recovery.hash || o.mode !== 'redeem' || !o.eventsChecked ||
      !o.safe || !o.finalized || o.transactionSent !== false || o.signingApproved !== false ||
      o.assets !== task.assets || o.shares !== task.shares || o.remainingShares !== task.remainingShares ||
      !o.balances.matches || !o.shareBalance.matches ||
      o.balances.delta !== task.assets || o.shareBalance.after !== task.remainingShares ||
      !amount(o.balances.before) || !amount(o.balances.after) || !amount(o.shareBalance.before) ||
      BigInt(o.balances.after) - BigInt(o.balances.before) !== BigInt(task.assets) ||
      BigInt(o.shareBalance.before) - BigInt(o.shareBalance.after) !== BigInt(task.shares) ||
      BigInt(o.beforeBlock.number) + 1n !== BigInt(o.block.number))
    throw new Error('Vault gateway recovery differs from the expected finalized redemption');
  return o;
}
