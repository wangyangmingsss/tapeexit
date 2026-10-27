import { decodeEventLog, getAddress, type Hex, type Address } from 'viem';
import { poolAbi, tokenAbi } from '../config';
import { StrictRpc, ExitError } from './rpc';
import type { Plan, Snapshot } from './protocol';

interface Log { address: Address; data: Hex; topics: [Hex, ...Hex[]]; logIndex: Hex }
interface Receipt { status: Hex; blockNumber: Hex; blockHash: Hex; transactionHash: Hex; from: Address; to: Address; logs: Log[] }
export interface Result {
  hash: Hex; blockNumber: string; blockHash: Hex; amount0: string; amount1: string;
  state: 'received-checked' | 'included-unverified'; finalized: boolean; safe: boolean;
}
export type ReceiptExpectation = Pick<Plan, 'account' | 'manager' | 'data'> & {
  snapshot: Pick<Snapshot, 'pool' | 'tickLower' | 'tickUpper' | 'token0' | 'token1'>;
};
export async function pendingState(rpc: StrictRpc, hash: Hex, account: Address, knownNonce?: bigint):
Promise<{ state: 'pending' | 'replaced-or-dropped'; nonce?: bigint }> {
  const tx = await rpc.request<{ from: Address; nonce: Hex } | null>('eth_getTransactionByHash', [hash],
    value => value ? { from: value.from, nonce: value.nonce } : null);
  if (tx && getAddress(tx.from) !== getAddress(account))
    throw new ExitError('TRANSACTION_MISMATCH', 'Pending transaction sender differs');
  const nonce = tx ? BigInt(tx.nonce) : knownNonce;
  if (nonce !== undefined) {
    const minedNonce = await rpc.request<Hex>('eth_getTransactionCount', [account, 'latest']);
    if (BigInt(minedNonce) > nonce) return { state: 'replaced-or-dropped', nonce };
  }
  return { state: 'pending', nonce };
}
export async function inspectReceipt(rpc: StrictRpc, hash: Hex, plan: ReceiptExpectation): Promise<Result | null> {
  const receipt = await rpc.request<Receipt | null>('eth_getTransactionReceipt', [hash], r =>
    r ? ({ status: r.status, blockNumber: r.blockNumber, blockHash: r.blockHash, transactionHash: r.transactionHash, from: r.from, to: r.to,
      logs: r.logs.map(l => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex })) }) : null);
  if (!receipt) return null;
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      getAddress(receipt.from) !== getAddress(plan.account) || getAddress(receipt.to) !== getAddress(plan.manager))
    throw new ExitError('TRANSACTION_MISMATCH', 'Receipt identity differs from approved transaction');
  if (BigInt(receipt.status) !== 1n) throw new ExitError('REVERTED', 'Transaction reverted');
  const tx = await rpc.request<{ from: Address; to: Address; input: Hex; value: Hex }>('eth_getTransactionByHash', [hash],
    t => ({ from: t.from, to: t.to, input: t.input, value: t.value }));
  if (getAddress(tx.from) !== getAddress(plan.account) || getAddress(tx.to) !== getAddress(plan.manager) ||
      tx.input.toLowerCase() !== plan.data.toLowerCase() || BigInt(tx.value) !== 0n)
    throw new ExitError('TRANSACTION_MISMATCH', 'Actual transaction differs from approved plan');
  const block = await rpc.block(receipt.blockNumber);
  if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
    throw new ExitError('REORG', 'Receipt block changed');
  const collected = [0n, 0n];
  const transfers = [0n, 0n];
  for (const log of receipt.logs) {
    try {
      if (getAddress(log.address) === getAddress(plan.snapshot.pool)) {
        const decoded = decodeEventLog({ abi: poolAbi, eventName: 'Collect', data: log.data, topics: log.topics });
        const a = decoded.args;
        if (getAddress(a.owner) === getAddress(plan.manager) && getAddress(a.recipient) === getAddress(plan.account) &&
            a.tickLower === plan.snapshot.tickLower && a.tickUpper === plan.snapshot.tickUpper) {
          collected[0] += a.amount0; collected[1] += a.amount1;
        }
      }
      for (const [index, asset] of [plan.snapshot.token0, plan.snapshot.token1].entries()) {
        if (getAddress(log.address) !== getAddress(asset.address)) continue;
        const d = decodeEventLog({ abi: tokenAbi, eventName: 'Transfer', data: log.data, topics: log.topics });
        if (getAddress(d.args.from) === getAddress(plan.snapshot.pool) && getAddress(d.args.to) === getAddress(plan.account))
          transfers[index] += d.args.value;
      }
    } catch { /* Unrelated or incompatible events are not evidence. */ }
  }
  let safe = false, finalized = false;
  try { safe = BigInt((await rpc.block('safe')).number) >= BigInt(receipt.blockNumber); } catch { /* Unsupported is unconfirmed. */ }
  try { finalized = BigInt((await rpc.block('finalized')).number) >= BigInt(receipt.blockNumber); } catch { /* Unsupported is unconfirmed. */ }
  await rpc.assertBlock(block);
  const checked = (collected[0] > 0n || collected[1] > 0n) && collected.every((n, i) => n === transfers[i]);
  return { hash, blockNumber: BigInt(receipt.blockNumber).toString(), blockHash: receipt.blockHash,
    amount0: collected[0].toString(), amount1: collected[1].toString(),
    state: checked ? 'received-checked' : 'included-unverified', safe, finalized };
}
