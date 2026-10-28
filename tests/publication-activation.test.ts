import { beforeEach, expect, it, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { StrictRpc, type Block } from '../src/core/rpc';
import { PublicationActivation, activationAbi, ACTIVATION_CONSENT, type ActivationJournal,
  type ActivationPreview, type ActivationAttempt } from '../tools/publication-activation';
import type { PublicationWorkbench } from '../tools/publication-workbench-core';
import { inspectPublication } from '../tools/operations-core';
import { openPublicationJournal } from '../tools/publication-journal';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../tools/operations-core', () => ({ inspectPublication: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });
const publisher = '0x1000000000000000000000000000000000000001';
const container = '0x2000000000000000000000000000000000000002';
const txHash = `0x${'ab'.repeat(32)}` as Hex;
const block: Block = { number: '0x10', timestamp: '0x3e8', hash: `0x${'cd'.repeat(32)}` };
const hex = (n: bigint): Hex => `0x${n.toString(16)}`;
function fixture(saved?: ActivationJournal) {
  let now = 10_000, fee = 0n, price = 21_000_000n, gas = 188_121n, nonce = '0x0', pending = '0x0';
  let paid = 0n, containerPaid = 0n, live = false, containerLive = false, fail = false;
  let receipt: Record<string, unknown> | null = null, actual: Record<string, unknown> | null = null;
  const upload = { contextId: 'a'.repeat(64), profile: { publisher, container, circuitId: '2', processorIndex: '289' },
    verifyCompleted: vi.fn(async () => ({ containerLive: false })) };
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }]);
  vi.spyOn(rpc, 'checkChain').mockResolvedValue();
  vi.spyOn(rpc, 'pin').mockResolvedValue(block);
  vi.spyOn(rpc, 'block').mockResolvedValue(block);
  vi.spyOn(rpc, 'assertBlock').mockResolvedValue();
  vi.spyOn(rpc, 'gasPrice').mockImplementation(async () => price);
  vi.spyOn(rpc, 'estimate').mockImplementation(async () => gas);
  const methods: string[] = [];
  vi.spyOn(rpc, 'request').mockImplementation(async <T>(method: string, args: unknown[]): Promise<T> => {
    methods.push(method);
    let value: unknown;
    if (method === 'eth_getTransactionReceipt') value = receipt;
    else if (method === 'eth_getTransactionByHash') value = actual;
    else if (method === 'eth_getTransactionCount') value = args[1] === 'pending' ? pending : nonce;
    else if (method === 'eth_call') {
      const fn = decodeFunctionData({ abi: activationAbi, data: (args[0] as { data: Hex }).data }).functionName;
      if (fn === 'bind') return '0x' as T;
      const result = { monthlyFee: fee, isLive: live, isContainerLive: containerLive,
        paidUntil: paid, containerPaidUntil: containerPaid }[fn];
      value = encodeFunctionResult({ abi: activationAbi, functionName: fn, result });
    } else throw new Error(`Unexpected RPC method ${method}`);
    return value as T;
  });
  const writes: ActivationJournal[] = [];
  const journal = saved ?? { schemaVersion: 1 as const, contextId: PublicationActivation.contextId(upload as unknown as PublicationWorkbench), attempts: [] };
  const store = { save: vi.fn(async (j: ActivationJournal) => {
    if (fail) throw new Error('disk full');
    writes.push(structuredClone(j));
  }) };
  const bench = new PublicationActivation(rpc, upload as unknown as PublicationWorkbench, journal, store, () => now);
  return { bench, rpc, upload, journal, writes, methods, store,
    preview: () => bench.previewActivation() as Promise<ActivationPreview>,
    reserve: async () => { const q = await bench.previewActivation() as ActivationPreview;
      return bench.reserve(q.id, ACTIVATION_CONSENT, q.maximumTotalWei); },
    setFee: (n: bigint) => { fee = n; }, setPrice: (n: bigint) => { price = n; },
    setGas: (n: bigint) => { gas = n; }, pending: () => { pending = '0x1'; },
    nonce: () => { nonce = pending = '0x1'; }, advance: (ms: number) => { now += ms; },
    fail: () => { fail = true; },
    state: (p: bigint, c = p, n = true, l = true) => { paid = p; containerPaid = c; live = n; containerLive = l; },
    mine(a: ActivationAttempt, status = '0x1') {
      const tx = a.quote.transaction;
      receipt = { status, transactionHash: txHash, blockNumber: block.number, blockHash: block.hash,
        gasUsed: hex(188_121n), effectiveGasPrice: tx.gasPrice };
      actual = { hash: txHash, from: tx.from, to: tx.to, input: tx.data, value: tx.value,
        nonce: tx.nonce, chainId: tx.chainId, gas: tx.gas, gasPrice: tx.gasPrice,
        blockNumber: block.number, blockHash: block.hash, type: '0x0' };
      if (status === '0x1') { paid = containerPaid = 1000n + 30n * 86400n; live = containerLive = true; }
      return { receipt, actual };
    },
  };
}

it('quotes only the exact canonical bind after full upload verification, without signing', async () => {
  const f = fixture(), q = await f.preview();
  expect(f.upload.verifyCompleted).toHaveBeenCalledOnce();
  expect(inspectPublication).toHaveBeenCalledOnce();
  expect(f.bench.context().name).toBe('2.2.289.tape');
  expect(decodeFunctionData({ abi: activationAbi, data: q.transaction.data })).toEqual({
    functionName: 'bind', args: ['2.2.289.tape', container, 1n],
  });
  expect(q.serviceFeeWei).toBe('0');
  expect(q.maximumTotalWei).toBe((225746n * 21000000n).toString());
  expect(f.methods.some(m => /send|sign/i.test(m))).toBe(false);
  expect(f.journal.attempts).toHaveLength(0);
});
it('requires separate exact fee consent and persists before handing the transaction to the browser', async () => {
  const f = fixture(), q = await f.preview();
  await expect(f.bench.reserve(q.id, 'upload consent', q.maximumTotalWei)).rejects.toThrow('Explicit');
  expect(f.journal.attempts).toHaveLength(0);
  f.setFee(1000n);
  const a = await f.reserve();
  expect(a.quote.transaction.value).toBe('0x3e8');
  expect(f.writes.at(-1)?.attempts[0]).toEqual(a);
  const restarted = fixture(structuredClone(f.writes.at(-1)!));
  expect(restarted.bench.context().unresolved).toBe(a.id);
  await expect(restarted.preview()).rejects.toThrow('unresolved');
});
it.each(['fee', 'price', 'gas', 'nonce', 'expiry', 'state'])('invalidates a changed %s before reservation', async change => {
  const f = fixture(), q = await f.preview();
  if (change === 'fee') f.setFee(1n);
  if (change === 'price') f.setPrice(22_000_000n);
  if (change === 'gas') f.setGas(188_122n);
  if (change === 'nonce') f.nonce();
  if (change === 'expiry') f.advance(120_001);
  if (change === 'state') f.state(10n, 10n, false, false);
  await expect(f.bench.reserve(q.id, ACTIVATION_CONSENT, q.maximumTotalWei)).rejects.toThrow(/changed|expired/);
  expect(f.journal.attempts).toHaveLength(0);
});
it('blocks incomplete uploads, pending wallet transactions, gas cap breaches and pin failures', async () => {
  const incomplete = fixture();
  incomplete.upload.verifyCompleted.mockRejectedValueOnce(new Error('Complete all upload bytes first'));
  await expect(incomplete.preview()).rejects.toThrow('Complete');
  const pending = fixture(); pending.pending(); await expect(pending.preview()).rejects.toThrow('pending');
  const price = fixture(); price.setPrice(30_000_001n); await expect(price.preview()).rejects.toThrow('price');
  const gas = fixture(); gas.setGas(500_000n); await expect(gas.preview()).rejects.toThrow('estimate');
  const pins = fixture(); vi.mocked(inspectPublication).mockRejectedValueOnce(new Error('binding code differs'));
  await expect(pins.preview()).rejects.toThrow('code differs');
});
it('does not renew an already active name automatically and refreshes observations after restart', async () => {
  const f = fixture(); f.state(2_593_000n);
  expect(await f.bench.previewActivation()).toMatchObject({ live: true });
  expect(f.journal.attempts).toHaveLength(0);
  expect((await f.bench.refresh()).observed?.nameLive).toBe(true);
  const restarted = fixture(structuredClone(f.journal));
  expect(restarted.bench.context().observed).toBeNull();
});
it('verifies actual receipt, transaction, stable name/container expiry and stores actual EVM costs', async () => {
  const f = fixture(), a = await f.reserve();
  await f.bench.attachHash(a.id, txHash); f.mine(a);
  const result = await f.bench.reconcile();
  expect(result.unresolved).toBeNull();
  expect(result.attempts[0]).toMatchObject({ status: 'confirmed', gasUsed: '188121', effectiveGasPriceWei: '21000000',
    state: { nameLive: true, containerLive: true, paidUntil: '2593000' } });
  const restarted = fixture(structuredClone(f.writes.at(-1)!));
  expect(restarted.bench.context().attempts[0].status).toBe('confirmed');
  expect(restarted.bench.context().observed).toBeNull();
});
it('accepts larger unused wallet EIP-1559 limits when actual settled fees fit the consent', async () => {
  const f = fixture(), a = await f.reserve();
  await f.bench.attachHash(a.id, txHash);
  const { actual } = f.mine(a);
  Object.assign(actual, { type: '0x2', gas: '0x100000', maxFeePerGas: hex(40_000_000n), maxPriorityFeePerGas: '0x1' });
  expect((await f.bench.reconcile()).attempts[0].status).toBe('confirmed');
});
it.each(['input', 'to', 'from', 'value', 'nonce', 'chainId', 'blockHash', 'gasPrice'])(
  'keeps a mismatched %s unresolved without claiming activation', async key => {
    const f = fixture(), a = await f.reserve(); await f.bench.attachHash(a.id, txHash);
    const { actual } = f.mine(a);
    actual[key] = key === 'input' ? '0x00' : ['from', 'to'].includes(key) ? container : '0x1';
    await expect(f.bench.reconcile()).rejects.toThrow();
    expect(f.bench.context().unresolved).toBe(a.id);
  });
it.each(['short-expiry', 'container-expiry', 'name-not-live', 'container-not-live', 'gas-used', 'fee', 'receipt-hash'])(
  'does not accept incorrect activation evidence: %s', async mode => {
    const f = fixture(), a = await f.reserve(); await f.bench.attachHash(a.id, txHash);
    const { receipt } = f.mine(a);
    if (mode === 'short-expiry') f.state(1001n);
    if (mode === 'container-expiry') f.state(2593000n, 1001n);
    if (mode === 'name-not-live') f.state(2593000n, 2593000n, false, true);
    if (mode === 'container-not-live') f.state(2593000n, 2593000n, true, false);
    if (mode === 'gas-used') receipt.gasUsed = hex(BigInt(a.quote.transaction.gas) + 1n);
    if (mode === 'fee') receipt.effectiveGasPrice = hex(30_000_001n);
    if (mode === 'receipt-hash') receipt.transactionHash = `0x${'ee'.repeat(32)}`;
    await expect(f.bench.reconcile()).rejects.toThrow();
    expect(f.bench.context().attempts[0].status).toBe('reserved');
  });
it('retains missing receipts and unstable blocks, and records a revert without successful activation', async () => {
  const f = fixture(), a = await f.reserve(); await f.bench.attachHash(a.id, txHash);
  await expect(f.bench.reconcile()).rejects.toThrow('not confirmed');
  f.mine(a);
  vi.mocked(f.rpc.pin).mockResolvedValueOnce({ ...block, number: '0xf' });
  await expect(f.bench.reconcile()).rejects.toThrow('not yet stable');
  f.mine(a, '0x0');
  const result = await f.bench.reconcile();
  expect(result.attempts[0].status).toBe('reverted');
  expect(result.observed?.containerLive).toBe(true); // An observation alone never proves this reverted call succeeded.
});
it('requires explicit cancellation and unchanged nonce, and refuses to cancel hashed requests', async () => {
  const f = fixture(), a = await f.reserve();
  await expect(f.bench.cancel(a.id, 'assume')).rejects.toThrow('Explicit');
  await f.bench.cancel(a.id, 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE');
  expect(f.bench.context().attempts[0].status).toBe('cancelled-by-user');
  const p = fixture(), b = await p.reserve(); p.pending();
  await expect(p.bench.cancel(b.id, 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE')).rejects.toThrow('pending');
  await p.bench.attachHash(b.id, txHash);
  await expect(p.bench.cancel(b.id, 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE')).rejects.toThrow('hashed');
});
it('rejects altered hashes, disk failures and corrupt restored evidence', async () => {
  const f = fixture(), a = await f.reserve();
  await expect(f.bench.attachHash(a.id, '0x01')).rejects.toThrow('hash');
  await f.bench.attachHash(a.id, txHash);
  await expect(f.bench.attachHash(a.id, `0x${'ff'.repeat(32)}`)).rejects.toThrow('unresolved');
  f.mine(a); await f.bench.reconcile();
  const saved = structuredClone(f.writes.at(-1)!);
  saved.attempts[0].quote.transaction.value = '0x1';
  expect(() => fixture(saved)).toThrow('journal entry');
  const disk = fixture(), q = await disk.preview(); disk.fail();
  await expect(disk.bench.reserve(q.id, ACTIVATION_CONSENT, q.maximumTotalWei)).rejects.toThrow('disk full');
  await expect(disk.preview()).rejects.toThrow('journal write failed');
});
it('serializes simultaneous activation checks and preserves its separate journal without touching upload files', async () => {
  const f = fixture(); let release!: () => void;
  f.upload.verifyCompleted.mockImplementationOnce(async () => {
    await new Promise<void>(resolve => { release = resolve; }); return { containerLive: false };
  });
  const checking = f.preview();
  await expect(f.preview()).rejects.toThrow('already running');
  release(); await checking;
  const dir = await mkdtemp(join(tmpdir(), 'activation-journal-'));
  try {
    const path = join(dir, 'activation.json');
    const store = await openPublicationJournal<ActivationJournal>(path, f.journal.contextId, f.journal);
    await store.save(f.journal); await store.close();
    const restarted = await openPublicationJournal<ActivationJournal>(path, f.journal.contextId, f.journal);
    expect(JSON.parse(await readFile(path, 'utf8')).attempts).toEqual([]);
    await restarted.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
