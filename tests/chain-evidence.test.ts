import { describe, expect, it } from 'vitest';
import { assertTransactionIdentity, minedTransaction, receiptEvidence, receiptIdentity } from '../src/core/chain-evidence';

const txHash = `0x${'ab'.repeat(32)}`, blockHash = `0x${'cd'.repeat(32)}`, otherHash = `0x${'ef'.repeat(32)}`;
const from = '0x1000000000000000000000000000000000000001';
const to = '0x2000000000000000000000000000000000000002';
const identity = { status: '0x1', transactionHash: txHash, blockHash, blockNumber: '0x10',
  transactionIndex: '0x2', from, to };
const log = { address: to, topics: [otherHash], data: '0x', logIndex: '0x5', removed: false,
  transactionHash: txHash, blockHash, blockNumber: '0x10', transactionIndex: '0x2' };
const transaction = { hash: txHash, blockHash, blockNumber: '0x10', transactionIndex: '0x2',
  from, to, input: '0x1234', value: '0x0' };
describe('mined transaction and receipt evidence', () => {
  it('accepts exact identities and ordered logs with gaps in the global block indexes', () => {
    const receipt = receiptEvidence({ ...identity, logs: [log, { ...log, logIndex: '0xa' }] });
    expect(receipt.logs).toHaveLength(2);
    expect(() => assertTransactionIdentity(minedTransaction(transaction), receipt)).not.toThrow();
  });
  it('accepts LOG0, empty successful logs and a reverted receipt with no logs', () => {
    expect(receiptEvidence({ ...identity, logs: [{ ...log, topics: [] }] }).logs[0].topics).toEqual([]);
    expect(receiptEvidence({ ...identity, logs: [] }).status).toBe('0x1');
    expect(receiptEvidence({ ...identity, status: '0x0', logs: [] }).status).toBe('0x0');
  });
  it.each([
    { status: '0x2' }, { status: 1 }, { status: '1' }, { status: '0x01' },
    { blockNumber: '0x00' }, { blockNumber: '-1' }, { blockNumber: '0x' + 'f'.repeat(65) },
    { blockHash: '0x1234' }, { blockHash: null }, { transactionHash: '0x12' },
    { transactionIndex: '0x00' }, { transactionIndex: 2 }, { from: null }, { to: null }, { to: '0x1234' },
  ])('rejects malformed receipt identity %j', change => {
    expect(() => receiptIdentity({ ...identity, ...change })).toThrowError(expect.objectContaining({ code: 'RPC_INVALID' }));
  });
  it.each([
    { removed: true }, { removed: undefined }, { logIndex: '0x05' }, { logIndex: null },
    { blockHash: otherHash }, { blockNumber: '0x11' }, { transactionHash: otherHash }, { transactionIndex: '0x3' },
    { address: '0x1234' }, { topics: [otherHash, otherHash, otherHash, otherHash, otherHash] },
    { topics: ['0x1234'] }, { topics: null }, { data: '0x1' }, { data: '0xzz' },
  ])('rejects invalid, removed or foreign log metadata %j', change => {
    expect(() => receiptEvidence({ ...identity, logs: [{ ...log, ...change }] }))
      .toThrowError(expect.objectContaining({ code: 'RPC_INVALID' }));
  });
  it.each([
    [log, { ...log }],
    [log, { ...log, logIndex: '0x4' }],
  ])('rejects duplicate and decreasing indexes', logs => {
    expect(() => receiptEvidence({ ...identity, logs })).toThrowError(expect.objectContaining({ code: 'RPC_INVALID' }));
  });
  it('bounds log arrays and rejects logs for failed transactions', () => {
    expect(() => receiptEvidence({ ...identity, logs: Array(4097).fill(log) })).toThrow();
    expect(() => receiptEvidence({ ...identity, status: '0x0', logs: [log] })).toThrow();
    expect(() => receiptEvidence({ ...identity, logs: null })).toThrow();
  });
  it.each([
    { hash: otherHash }, { blockHash: otherHash }, { blockNumber: '0x11' }, { transactionIndex: '0x3' },
    { from: to }, { to: from },
  ])('rejects a well-formed transaction with mismatched identity %j', change => {
    expect(() => assertTransactionIdentity(minedTransaction({ ...transaction, ...change }), receiptIdentity(identity)))
      .toThrowError(expect.objectContaining({ code: 'TRANSACTION_MISMATCH' }));
  });
  it.each([
    { hash: null }, { blockHash: null }, { blockNumber: null }, { transactionIndex: null },
    { input: '0x1' }, { value: '0x00' }, { value: 0 },
  ])('rejects pending or malformed mined transaction %j', change => {
    expect(() => minedTransaction({ ...transaction, ...change }))
      .toThrowError(expect.objectContaining({ code: 'RPC_INVALID' }));
  });
  it.each([null, undefined, [], '0x1'])('rejects absent and non-object evidence %j', value => {
    expect(() => receiptIdentity(value)).toThrow();
    expect(() => minedTransaction(value)).toThrow();
  });
});
