import { decodeEventLog, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { tokenAbi } from '../config';
import { assertTransactionIdentity, minedTransaction, receiptEvidence } from './chain-evidence';
import { SparkVaultAdapter, decodeVaultExit, vaultAccount } from './vault-adapter';
import { SPARK_USDC, vaultAbi } from './vault-config';
import { ExitError, type StrictRpc } from './rpc';

export interface VaultRecoveryTask {
  schemaVersion: 1;
  protocolId: 'spark-spusdc';
  chainId: 196;
  vault: Address;
  account: Address;
  hash: Hex;
}
export function vaultRecoveryTask(account: string, hash: string): VaultRecoveryTask {
  if (!/^0x[0-9a-f]{64}$/i.test(hash) || /^0x0{64}$/i.test(hash))
    throw new ExitError('VAULT_HASH', 'Enter the complete transaction hash');
  return { schemaVersion: 1, protocolId: 'spark-spusdc', chainId: 196,
    vault: SPARK_USDC.vault, account: vaultAccount(account), hash: hash.toLowerCase() as Hex };
}
export function importVaultRecovery(text: string): VaultRecoveryTask {
  if (new TextEncoder().encode(text).length > 16384) throw new ExitError('VAULT_RECORD', 'Recovery record too large');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 ||
      value.protocolId !== 'spark-spusdc' || value.chainId !== 196 ||
      typeof value.vault !== 'string' || getAddress(value.vault) !== SPARK_USDC.vault ||
      typeof value.account !== 'string' || typeof value.hash !== 'string')
    throw new ExitError('VAULT_RECORD', 'Recovery record belongs to a different protocol or chain');
  // Import only hints; never restore a supplied "verified" status or transaction data.
  return vaultRecoveryTask(value.account, value.hash);
}
export const VAULT_RECOVERY_KEY = 'tapeexit:spark-vault:recovery:v1';
export function loadVaultRecovery(): VaultRecoveryTask | undefined {
  try {
    const raw = localStorage.getItem(VAULT_RECOVERY_KEY);
    return raw ? importVaultRecovery(raw) : undefined;
  } catch { return undefined; }
}
export function saveVaultRecovery(task: VaultRecoveryTask): boolean {
  try {
    const safe = importVaultRecovery(JSON.stringify(task));
    const text = JSON.stringify(safe);
    localStorage.setItem(VAULT_RECOVERY_KEY, text);
    return localStorage.getItem(VAULT_RECOVERY_KEY) === text;
  } catch { return false; }
}
export function clearVaultRecovery(): boolean {
  try {
    localStorage.removeItem(VAULT_RECOVERY_KEY);
    return localStorage.getItem(VAULT_RECOVERY_KEY) === null;
  } catch { return false; }
}
export async function inspectVaultRecovery(rpc: StrictRpc, hint: VaultRecoveryTask) {
  const task = importVaultRecovery(JSON.stringify(hint));
  await rpc.checkChain(196);
  const raw = await rpc.request('eth_getTransactionReceipt', [task.hash],
    value => value === null ? null : receiptEvidence(value));
  if (raw === null) return { state: 'pending' } as const;
  const receipt = receiptEvidence(raw);
  const tx = minedTransaction(await rpc.request('eth_getTransactionByHash', [task.hash], minedTransaction));
  assertTransactionIdentity(tx, receipt);
  if (tx.hash !== task.hash || tx.from !== task.account || tx.to !== SPARK_USDC.vault || BigInt(tx.value) !== 0n)
    throw new ExitError('VAULT_TRANSACTION', 'Transaction differs from the account or configured vault');
  const exit = decodeVaultExit(tx.input, task.account);
  const after = await rpc.block(receipt.blockNumber);
  if (after.hash.toLowerCase() !== receipt.blockHash) throw new ExitError('REORG', 'Receipt block changed');
  const adapter = new SparkVaultAdapter(rpc);
  await adapter.verifyDeployment(after);
  if (receipt.status === '0x0') {
    await rpc.assertBlock(after);
    return { state: 'reverted', blockNumber: receipt.blockNumber } as const;
  }
  const withdrawals: { assets: bigint; shares: bigint }[] = [];
  let burned = 0n, received = 0n;
  for (const log of receipt.logs) {
    if (log.address === SPARK_USDC.vault) {
      try {
        const event = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics, strict: true });
        if (event.eventName === 'Withdraw') {
          if (event.args.sender !== task.account || event.args.receiver !== task.account || event.args.owner !== task.account)
            throw new ExitError('VAULT_EVENTS', 'Withdrawal event account differs');
          withdrawals.push({ assets: event.args.assets, shares: event.args.shares });
        }
      } catch (error) {
        if (error instanceof ExitError) throw error;
        // Other vault events (including Drip) are expected.
      }
      try {
        const event = decodeEventLog({ abi: tokenAbi, data: log.data, topics: log.topics, strict: true });
        if (event.args.from === task.account && event.args.to === zeroAddress) burned += event.args.value;
      } catch { /* Not a share Transfer event. */ }
    } else if (log.address === SPARK_USDC.asset) {
      try {
        const event = decodeEventLog({ abi: tokenAbi, data: log.data, topics: log.topics, strict: true });
        if (event.args.from === SPARK_USDC.vault && event.args.to === task.account) received += event.args.value;
      } catch { /* Not an asset Transfer event. */ }
    }
  }
  const event = withdrawals[0];
  if (withdrawals.length !== 1 || !event || event.assets <= 0n || event.shares <= 0n ||
      (exit.mode === 'redeem' ? event.shares : event.assets) !== exit.amount ||
      burned !== event.shares || received !== event.assets)
    throw new ExitError('VAULT_EVENTS', 'Withdrawal, share burn and USDC receipt evidence do not match');
  const height = BigInt(after.number);
  if (!height) throw new ExitError('RPC_INVALID', 'Missing parent block');
  const before = await rpc.block(`0x${(height - 1n).toString(16)}`);
  const [pre, post, preAsset, postAsset, safe, finalized] = await Promise.all([
    adapter.snapshotAt(task.account, before), adapter.snapshotAt(task.account, after),
    adapter.read<bigint>(tokenAbi, SPARK_USDC.asset, 'balanceOf', [task.account], before),
    adapter.read<bigint>(tokenAbi, SPARK_USDC.asset, 'balanceOf', [task.account], after),
    rpc.block('safe'), rpc.block('finalized'),
  ]);
  const finalRaw = await rpc.request('eth_getTransactionReceipt', [task.hash],
    value => value === null ? null : receiptEvidence(value));
  if (finalRaw === null || JSON.stringify(receiptEvidence(finalRaw)) !== JSON.stringify(receipt))
    throw new ExitError('REORG', 'Receipt changed during recovery');
  const finalTx = minedTransaction(await rpc.request('eth_getTransactionByHash', [task.hash], minedTransaction));
  if (JSON.stringify(tx) !== JSON.stringify(finalTx))
    throw new ExitError('VAULT_TRANSACTION', 'Transaction changed during recovery');
  await rpc.assertBlock(before);
  await rpc.assertBlock(after);
  const sharesMatch = pre.shares - post.shares === event.shares;
  const assetsMatch = postAsset - preAsset === event.assets;
  const isFinalized = BigInt(finalized.number) >= height;
  return {
    state: !sharesMatch || !assetsMatch ? 'block-state-mismatch' :
      isFinalized ? 'verified' : 'awaiting-finality',
    task, block: after, beforeBlock: before,
    mode: exit.mode, assets: event.assets.toString(), shares: event.shares.toString(),
    remainingShares: post.shares.toString(),
    balances: { before: preAsset.toString(), after: postAsset.toString(),
      delta: (postAsset - preAsset).toString(), matches: assetsMatch },
    shareBalance: { before: pre.shares.toString(), after: post.shares.toString(), matches: sharesMatch },
    eventsChecked: true, safe: BigInt(safe.number) >= height, finalized: isFinalized,
    transactionSent: false, signingApproved: false,
    limitations: 'Parent and receipt block-end balances corroborate the events, but cannot isolate other activity in the same block. No wallet signing or independent review is implied.',
  } as const;
}
