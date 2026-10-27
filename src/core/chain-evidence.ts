import { getAddress, type Address, type Hex } from 'viem';
import { ExitError } from './rpc';

export interface ReceiptIdentity {
  status: Hex; blockNumber: Hex; blockHash: Hex; transactionHash: Hex; transactionIndex: Hex;
  from: Address; to: Address;
}
interface ReceiptLog {
  address: Address; data: Hex; topics: [Hex, ...Hex[]]; logIndex: Hex;
  blockNumber: Hex; blockHash: Hex; transactionHash: Hex; transactionIndex: Hex; removed: false;
}
export interface ReceiptEvidence extends ReceiptIdentity { logs: ReceiptLog[] }
export interface MinedTransaction {
  hash: Hex; blockNumber: Hex; blockHash: Hex; transactionIndex: Hex;
  from: Address; to: Address; input: Hex; value: Hex;
}
function invalid(): never { throw new ExitError('RPC_INVALID', 'Invalid transaction or receipt evidence'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function quantity(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value)) return invalid();
  return value.toLowerCase() as Hex;
}
function hash(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) return invalid();
  return value.toLowerCase() as Hex;
}
function address(value: unknown): Address {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value)) return invalid();
  try { return getAddress(value); } catch { return invalid(); }
}
function data(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value)) return invalid();
  return value.toLowerCase() as Hex;
}
export function receiptIdentity(value: unknown): ReceiptIdentity {
  const r = record(value);
  if (r.status !== '0x0' && r.status !== '0x1') return invalid();
  return { status: r.status, blockNumber: quantity(r.blockNumber), blockHash: hash(r.blockHash),
    transactionHash: hash(r.transactionHash), transactionIndex: quantity(r.transactionIndex),
    from: address(r.from), to: address(r.to) };
}
export function receiptEvidence(value: unknown): ReceiptEvidence {
  const r = record(value), identity = receiptIdentity(r);
  if (!Array.isArray(r.logs) || r.logs.length > 4096 || (identity.status === '0x0' && r.logs.length)) return invalid();
  let previous = -1n;
  const logs = r.logs.map(value => {
    const l = record(value), logIndex = quantity(l.logIndex);
    if (!Array.isArray(l.topics) || l.topics.length > 4 || l.removed !== false ||
        BigInt(logIndex) <= previous) return invalid();
    previous = BigInt(logIndex);
    const log = { address: address(l.address), data: data(l.data), logIndex,
      topics: l.topics.map(hash) as [Hex, ...Hex[]], removed: false as const,
      blockNumber: quantity(l.blockNumber), blockHash: hash(l.blockHash),
      transactionHash: hash(l.transactionHash), transactionIndex: quantity(l.transactionIndex) };
    if (log.blockNumber !== identity.blockNumber || log.blockHash !== identity.blockHash ||
        log.transactionHash !== identity.transactionHash || log.transactionIndex !== identity.transactionIndex)
      return invalid();
    return log;
  });
  return { ...identity, logs };
}
export function minedTransaction(value: unknown): MinedTransaction {
  const t = record(value);
  return { hash: hash(t.hash), blockNumber: quantity(t.blockNumber), blockHash: hash(t.blockHash),
    transactionIndex: quantity(t.transactionIndex), from: address(t.from), to: address(t.to),
    input: data(t.input), value: quantity(t.value) };
}
export function assertTransactionIdentity(tx: MinedTransaction, receipt: ReceiptIdentity) {
  if (tx.hash !== receipt.transactionHash || tx.blockNumber !== receipt.blockNumber ||
      tx.blockHash !== receipt.blockHash || tx.transactionIndex !== receipt.transactionIndex ||
      tx.from !== receipt.from || tx.to !== receipt.to)
    throw new ExitError('TRANSACTION_MISMATCH', 'Transaction and receipt identities differ');
}
