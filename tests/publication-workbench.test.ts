import { describe, expect, it, vi, beforeEach } from 'vitest';
import { keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { StrictRpc, type Block } from '../src/core/rpc';
import { PublicationWorkbench, type UploadAttempt, type UploadJournal, type UploadPreview } from '../tools/publication-workbench-core';
import { digest, encodePublishFile, fallbackTransaction, REGISTRY } from '../tools/publish-core';
import { inspectPublication, parsePublishProfile } from '../tools/operations-core';
import { resumePublication } from '../tools/resume-publication-core';
import { verifyPublication } from '../tools/verify-publication-core';
import { batchData, checkBatchCode, BATCH_CONSENT, BATCH_IMPLEMENTATION } from '../tools/publication-batch';
import * as migration from '../tools/resume-publication-update';

vi.mock('../tools/operations-core', async original => ({
  ...await original<typeof import('../tools/operations-core')>(), inspectPublication: vi.fn(),
}));
vi.mock('../tools/resume-publication-core', () => ({ resumePublication: vi.fn() }));
vi.mock('../tools/verify-publication-core', () => ({ verifyPublication: vi.fn() }));
vi.mock('../tools/publication-batch', async original => ({
  ...await original<typeof import('../tools/publication-batch')>(),
  checkBatchCode: vi.fn(),
}));
const testSigner = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const publisher = testSigner.address;
const container = '0x2000000000000000000000000000000000000002';
const txHash = `0x${'ab'.repeat(32)}` as Hex;
const contents = ['index.html', 'release-manifest.json'].map(path => {
  const bytes = Buffer.from(path);
  return { bytes, file: { path, size: bytes.length, sha256: digest(bytes), contentType: 'text/plain' } };
});
const publication = { contents, manifestSha256: contents[1].file.sha256 };
const ops = [...contents.flatMap(c => encodePublishFile(container, c.file, c.bytes)), fallbackTransaction(container)];
const profile = parsePublishProfile({ schemaVersion: 1, chainId: 196, publisher, container,
  circuitId: '2', processorIndex: '289', maxGasPerTransaction: '7000000',
  maxFeePerGasWei: '30000000', maxUploadCostWei: '7000000000000000',
  expectedCodeHashes: Object.fromEntries(['processor', 'container', 'opener', 'registry', 'binding', 'factory']
    .map(name => [name, keccak256('0x6000')])) });
it('binds migration to its old manifest and persists removal reservations before any wallet request', async () => {
  const f = fixture(), bytes = Buffer.from('old manifest');
  const previous = { manifestSha256: digest(bytes), contents: [{ bytes, file: {
    path: 'obsolete.js', size: bytes.length, sha256: digest(bytes), contentType: 'text/plain',
  } }] };
  const input = { ...profile, previousManifestSha256: previous.manifestSha256 };
  const contextId = PublicationWorkbench.contextId(input, publication.manifestSha256);
  expect(contextId).not.toBe(PublicationWorkbench.contextId(profile, publication.manifestSha256));
  const journal: UploadJournal = { schemaVersion: 1, contextId, authorization: null, attempts: [] };
  const operation = migration.updateRemovals(container, publication, previous)[0];
  vi.spyOn(migration, 'resumePublicationUpdate').mockResolvedValue({ schemaVersion: 1,
    status: 'UNSIGNED_EXACT_OLD_FILE_REMOVALS', container, block, manifestSha256: publication.manifestSha256,
    previousManifestSha256: previous.manifestSha256, checked: [], transactions: [operation], transactionCount: 1, scope: '' });
  expect(() => new PublicationWorkbench(f.rpc, input, publication, journal, f.store)).toThrow('exact trusted');
  const bench = new PublicationWorkbench(f.rpc, input, publication, journal, f.store, Date.now, previous);
  await bench.authorize(contextId, input.maxUploadCostWei);
  const preview = await bench.prepareNext() as UploadPreview;
  expect(preview.chunk).toBe(-1);
  expect(bench.context().migration?.siteMayBeUnavailableDuringUpdate).toBe(true);
  const reservation = await bench.reserve(preview.id);
  expect(f.writes.at(-1)?.attempts[0]).toEqual(reservation);
  const restarted = new PublicationWorkbench(f.rpc, input, publication, structuredClone(f.writes.at(-1)!), f.store, Date.now, previous);
  await expect(restarted.prepareNext()).rejects.toThrow('unresolved');
  await restarted.attachHash(reservation.id, txHash); f.mine(reservation);
  await expect(restarted.reconcile()).rejects.toThrow('did not produce matching');
  vi.mocked(migration.resumePublicationUpdate).mockResolvedValueOnce({ schemaVersion: 1,
    status: 'UNSIGNED_EXACT_OLD_FILE_REMOVALS', container, block, manifestSha256: publication.manifestSha256,
    previousManifestSha256: previous.manifestSha256, checked: [], transactions: [], transactionCount: 0, scope: '' });
  expect((await restarted.reconcile()).attempts[0].status).toBe('confirmed');
  expect(f.requests.some(m => /send|sign/i.test(m))).toBe(false);
  vi.mocked(migration.resumePublicationUpdate).mockRestore();
});
const block: Block = { number: '0x10', hash: `0x${'cd'.repeat(32)}`, timestamp: '0x123' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkBatchCode).mockResolvedValue(false);
});

function fixture(saved?: UploadJournal) {
  let now = Date.now(), next = 0, failSave = false, receipt: Record<string, unknown> | null = null;
  let actual: Record<string, unknown> | null = null, pendingNonce = '0x0';
  let price = 21_000_000n, estimate = 100_000n, nonce = '0x0';
  const requests: string[] = [], writes: UploadJournal[] = [];
  const rpc = new StrictRpc([{ operator: 'a', url: 'https://a.example' }, { operator: 'b', url: 'https://b.example' }]);
  vi.spyOn(rpc, 'request').mockImplementation(async (method: string, params: unknown[]) => {
    requests.push(method);
    if (method === 'eth_getTransactionReceipt') return receipt;
    if (method === 'eth_getTransactionByHash') return actual;
    if (method === 'eth_getTransactionCount') return params[1] === 'pending' ? pendingNonce : nonce;
    if (method === 'eth_call') return '0x';
    throw new Error('Unexpected method');
  });
  vi.spyOn(rpc, 'checkChain').mockResolvedValue();
  vi.spyOn(rpc, 'pin').mockResolvedValue(block);
  vi.spyOn(rpc, 'block').mockResolvedValue(block);
  vi.spyOn(rpc, 'assertBlock').mockResolvedValue();
  vi.spyOn(rpc, 'gasPrice').mockImplementation(async () => price);
  vi.spyOn(rpc, 'estimate').mockImplementation(async () => estimate);
  vi.mocked(resumePublication).mockImplementation(async () => ({
    schemaVersion: 1, status: 'UNSIGNED_RESUME_PLAN_ONLY', container, block,
    manifestSha256: publication.manifestSha256, checked: [], transactions: ops.slice(next),
    transactionCount: ops.length - next, scope: 'Test fixture only',
  }));
  vi.mocked(inspectPublication).mockResolvedValue({ block } as Awaited<ReturnType<typeof inspectPublication>>);
  vi.mocked(verifyPublication).mockResolvedValue({ status: 'published-bytes-checked', containerLive: false } as
    Awaited<ReturnType<typeof verifyPublication>>);
  const contextId = PublicationWorkbench.contextId(profile, publication.manifestSha256);
  const journal: UploadJournal = saved ?? { schemaVersion: 1, contextId, authorization: null, attempts: [] };
  const store = { save: async (j: UploadJournal) => { if (failSave) throw new Error('disk full'); writes.push(structuredClone(j)); } };
  const bench = new PublicationWorkbench(rpc, profile, publication, journal, store, () => now);
  return { bench, journal, rpc, store, writes, requests,
    advance: (ms: number) => { now += ms; },
    next: (n: number) => { next = n; },
    setPrice: (n: bigint) => { price = n; }, setEstimate: (n: bigint) => { estimate = n; },
    pending: () => { pendingNonce = '0x1'; }, failSave: () => { failSave = true; },
    async prepare() { return await bench.prepareNext() as UploadPreview; },
    authorize() { return bench.authorize(contextId, profile.maxUploadCostWei); },
    mine(a: UploadAttempt, status = '0x1') {
      actual = { ...a.transaction, input: a.transaction.data, hash: txHash,
        blockNumber: block.number, blockHash: block.hash };
      receipt = { status, transactionHash: txHash, gasUsed: '0x10000',
        effectiveGasPrice: a.transaction.gasPrice, blockNumber: block.number, blockHash: block.hash };
      nonce = '0x1'; pendingNonce = nonce;
      if (status === '0x1') next = (a.batch?.operations.at(-1) ?? a.operation) + 1;
      return { receipt, actual };
    },
  };
}
describe('bounded browser-wallet publication coordinator', () => {
  function legacyBatch() {
    const now = Date.now();
    const a: UploadAttempt = { id: 'legacy', operation: 0, createdAt: now, status: 'reserved',
      transaction: { from: publisher, to: publisher, data: batchData(ops.slice(0, 2)), value: '0x0',
        chainId: '0xc4', gas: '0xd59f80', gasPrice: '0x1c9c380', nonce: '0x0' },
      batch: { operations: [0, 1], requestId: '11111111-1111-4111-8111-111111111111',
        consent: BATCH_CONSENT, consentAt: now, needsUpgrade: true } };
    const f = fixture({ schemaVersion: 1,
      contextId: PublicationWorkbench.contextId(profile, publication.manifestSha256),
      authorization: { grantedAt: now, expiresAt: now + 3600000, maximumWei: profile.maxUploadCostWei },
      attempts: [a] });
    return { f, a };
  }
  it('ignores historical capability claims when preparing new single registry transactions', async () => {
    const f = fixture();
    f.journal.walletCapabilities = { publisher, chainId: 196, checkedAt: Date.now(),
      outcome: 'reported', atomicStatus: 'supported' };
    const restarted = fixture(structuredClone(f.journal));
    await restarted.authorize();
    const preview = await restarted.prepare();
    const a = await restarted.bench.reserve(preview.id);
    expect(restarted.bench.context().uploadMode).toBe('single-transaction');
    expect(a.transaction.to).toBe(REGISTRY);
    expect(a.batch).toBeUndefined();
    expect(BigInt(a.transaction.gas)).toBeLessThanOrEqual(7000000n);
    expect(restarted.writes.at(-1)?.walletCapabilities).toEqual(f.journal.walletCapabilities);
    expect(restarted.requests.some(m => /send|sign|capabilit/i.test(m))).toBe(false);
  });
  it('recovers an existing batch across restart, verifies bytes and resumes with a single transaction', async () => {
    const { f, a } = legacyBatch();
    await expect(f.bench.prepareNext()).rejects.toThrow('unresolved');
    await f.bench.recordBundle(a.id, 'old-wallet-bundle');
    await expect(f.bench.recordBundle(a.id, 'different')).rejects.toThrow('Bundle ID');
    expect(() => new PublicationWorkbench(f.rpc, profile, publication,
      structuredClone(f.writes.at(-1)!), f.store)).not.toThrow();
    await f.bench.attachHash(a.id, txHash); f.mine(a);
    await f.bench.reconcile();
    expect(f.bench.context().unresolved).toBeNull();
    const p = await f.prepare();
    expect(p.operation).toBe(2);
    expect(p.transaction.to).toBe(REGISTRY);
    expect(checkBatchCode).toHaveBeenCalledWith(f.rpc, publisher, block, false);
  });
  it('blocks unknown legacy cancellation and retains its entire budget after explicit rejection', async () => {
    const { f, a } = legacyBatch();
    await expect(f.bench.acknowledgeCancellation(a.id, 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE')).rejects.toThrow('Unknown batch');
    await f.bench.recordBatchFailure(a.id, 'USER_REJECTED_4001');
    await f.bench.acknowledgeCancellation(a.id, 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE');
    const cost = 14000000n * 30000000n;
    expect(f.bench.context().reservedWei).toBe(String(cost));
    const p = await f.prepare();
    await f.bench.reserve(p.id);
    expect(f.bench.context().reservedWei).toBe(String(cost + BigInt(p.maximumCostWei)));
    expect(f.bench.context().maximumWei).toBe(profile.maxUploadCostWei);
    expect(() => fixture(structuredClone(f.writes.at(-1)!))).not.toThrow();
  });
  it('rejects partial bytes, changed implementation and wrapper input in historical batches', async () => {
    const { f, a } = legacyBatch();
    await f.bench.attachHash(a.id, txHash);
    const { actual } = f.mine(a); f.next(1);
    await expect(f.bench.reconcile()).rejects.toThrow('matching publication bytes');
    f.next(2);
    vi.mocked(checkBatchCode).mockRejectedValueOnce(new Error('unsupported account implementation'));
    await expect(f.bench.reconcile()).rejects.toThrow('unsupported');
    actual.input = '0x1234';
    await expect(f.bench.reconcile()).rejects.toThrow('differs');
    expect(f.bench.context().unresolved).toBe(a.id);
  });
  it('retains reverted batch costs and rejects corrupt historical operation order', async () => {
    const { f, a } = legacyBatch();
    await f.bench.attachHash(a.id, txHash); f.mine(a, '0x0');
    await f.bench.reconcile();
    expect(f.bench.context().attempts[0].status).toBe('reverted');
    expect(f.bench.context().reservedWei).toBe(String(14000000n * 30000000n));
    const saved = structuredClone(f.writes.at(-1)!);
    saved.attempts[0].batch!.operations = [0, 2];
    expect(() => fixture(saved)).toThrow('batch reservation');
  });
  it.each(['wrong-signer', 'extra-authorization', 'wrong-chain', 'wrong-target', 'valid'])(
    'checks historical EIP-7702 signatures before accepting a batch: %s', async mode => {
      const { f, a } = legacyBatch();
      await f.bench.attachHash(a.id, txHash);
      const { actual } = f.mine(a);
      const signer = mode === 'valid' ? testSigner : privateKeyToAccount(`0x${'01'.repeat(32)}`);
      const signed = await signer.signAuthorization({ contractAddress: BATCH_IMPLEMENTATION, chainId: 196, nonce: 1 });
      const auth = { ...signed, chainId: '0xc4', nonce: '0x1', yParity: `0x${signed.yParity}` };
      if (mode === 'wrong-chain') auth.chainId = '0x1';
      if (mode === 'wrong-target') auth.address = container;
      Object.assign(actual, { type: '0x4', maxFeePerGas: a.transaction.gasPrice, maxPriorityFeePerGas: '0x1',
        authorizationList: mode === 'extra-authorization' ? [auth, auth] : [auth] });
      if (mode === 'valid') {
        await f.bench.reconcile();
        expect(f.bench.context().attempts[0].status).toBe('confirmed');
      } else {
        await expect(f.bench.reconcile()).rejects.toThrow(/authorization/i);
        expect(f.bench.context().unresolved).toBe(a.id);
      }
    });
  it('still rejects malformed capability metadata in historical journals', () => {
    const f = fixture();
    f.journal.walletCapabilities = { publisher, chainId: 1 as 196, checkedAt: Date.now(),
      outcome: 'reported', atomicStatus: 'supported' };
    expect(() => fixture(f.journal)).toThrow('capability observation');
  });
  it('quotes without signing and refuses reserve until explicit exact fee consent', async () => {
    const f = fixture(), preview = await f.prepare();
    expect(preview).toMatchObject({ operation: 0, remaining: 3, file: 'index.html',
      maximumCostWei: '2520000000000', transaction: { to: REGISTRY, value: '0x0', chainId: '0xc4' } });
    await expect(f.bench.reserve(preview.id)).rejects.toThrow('consent');
    await expect(f.bench.authorize('wrong-release', profile.maxUploadCostWei)).rejects.toThrow('consent');
    await expect(f.bench.authorize(f.bench.contextId, '1')).rejects.toThrow('consent');
    expect(f.writes).toHaveLength(0);
    expect(f.requests.some(m => /send|sign/i.test(m))).toBe(false);
  });
  it('counts only remaining chain calls and keeps historical operation indices unchanged', async () => {
    const f = fixture();
    const before = f.bench.context();
    expect(before.remainingTransactions).toBeNull();
    const initial = await f.bench.inspectProgress();
    expect(initial).toMatchObject({ totalOperations: 3, completedOperations: 0,
      requiredOperations: 3, remainingTransactions: 3 });
    expect(f.writes).toHaveLength(0);
    await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await expect(f.bench.inspectProgress()).rejects.toThrow('pending');
    await f.bench.attachHash(a.id, txHash); f.mine(a);
    const result = await f.bench.reconcile();
    expect(result).toMatchObject({ requiredOperations: 3, completedOperations: 1, remainingTransactions: 2 });
    const restarted = fixture(structuredClone(f.journal)); restarted.next(1);
    expect((await restarted.bench.inspectProgress()).remainingTransactions).toBe(2);
    expect(restarted.journal.attempts[0].operation).toBe(a.operation);
    expect(restarted.requests.some(m => /send|sign/i.test(m))).toBe(false);
  });
  it('persists the exact transaction before returning it and prevents double reservation', async () => {
    const f = fixture(); await f.authorize();
    const preview = await f.prepare(), a = await f.bench.reserve(preview.id);
    expect(a.transaction).toEqual(preview.transaction);
    expect(f.writes.at(-1)?.attempts[0]).toEqual(a);
    await expect(f.bench.reserve(preview.id)).rejects.toThrow();
    await expect(f.bench.prepareNext()).rejects.toThrow('unresolved');
    await expect(f.authorize()).rejects.toThrow('previous');
    expect(f.journal.attempts).toHaveLength(1);
  });
  it('keeps an unknown wallet result blocked after process restart', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    const restarted = fixture(structuredClone(f.writes.at(-1)!));
    expect(restarted.bench.context().unresolved).toBe(a.id);
    await expect(restarted.bench.prepareNext()).rejects.toThrow('unresolved');
    await expect(restarted.bench.reconcile()).rejects.toThrow('transaction hash');
  });
  it('checks receipt, mined calldata, nonce, gas, canonical block and file prefix before next upload', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await f.bench.attachHash(a.id, txHash); f.mine(a);
    await f.bench.reconcile();
    expect(f.bench.context().unresolved).toBeNull();
    expect(f.bench.context().attempts[0].status).toBe('confirmed');
    expect((await f.prepare()).operation).toBe(1);
    expect(f.rpc.assertBlock).toHaveBeenCalledWith(block);
    expect(f.requests.some(m => /send|sign/i.test(m))).toBe(false);
  });
  it('retains budget after an actual reverted transaction and allows a fresh quote', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await f.bench.attachHash(a.id, txHash); f.mine(a, '0x0');
    const reserved = f.bench.context().reservedWei;
    await f.bench.reconcile();
    expect(f.bench.context().attempts[0].status).toBe('reverted');
    expect(f.bench.context().reservedWei).toBe(reserved);
    expect((await f.prepare()).operation).toBe(0);
  });
  it('accepts wallet EIP-1559 gas adjustments within consent and persists conservative costs across restart', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await f.bench.attachHash(a.id, txHash);
    const { actual, receipt } = f.mine(a);
    Object.assign(actual, { type: '0x2', gas: '0xd743e', gasPrice: '0x1312d01',
      maxFeePerGas: '0x19bfcc1', maxPriorityFeePerGas: '0x1' });
    Object.assign(receipt, { gasUsed: '0x83e09', effectiveGasPrice: actual.gasPrice });
    await f.bench.reconcile();
    expect(f.bench.context().unresolved).toBeNull();
    expect(f.bench.context().attempts[0].transaction).toEqual(a.transaction);
    expect(f.bench.context().reservedWei).toBe((0xd743en * 0x19bfcc1n).toString());
    const restarted = fixture(structuredClone(f.writes.at(-1)!));
    expect(restarted.bench.context().reservedWei).toBe(f.bench.context().reservedWei);
    expect(restarted.bench.context().attempts[0].status).toBe('confirmed');
  });
  it.each([
    { gas: '0x6acfc1' },
    { maxFeePerGas: '0x1c9c381' },
    { maxPriorityFeePerGas: '0x1c9c381' },
  ])('keeps wallet fee adjustments outside consent unresolved: %j', async patch => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await f.bench.attachHash(a.id, txHash);
    const { actual, receipt } = f.mine(a);
    Object.assign(actual, { type: '0x2', maxFeePerGas: a.transaction.gasPrice,
      maxPriorityFeePerGas: '0x1', ...patch });
    if ('gas' in patch || 'maxFeePerGas' in patch)
      receipt.gasUsed = `0x${(BigInt(a.transaction.gas) + 1n).toString(16)}`;
    await expect(f.bench.reconcile()).rejects.toThrow('budget');
    expect(f.bench.context().unresolved).toBe(a.id);
    expect(f.journal.attempts[0].minedEnvelope).toBeUndefined();
  });
  it('reconciles consecutive wallet gas increases from settled usage without relaxing future signing caps', async () => {
    const f = fixture(); f.setEstimate(5_500_000n); await f.authorize();
    for (let operation = 0; operation < ops.length; operation++) {
      const p = await f.prepare();
      expect(p.operation).toBe(operation);
      expect(BigInt(p.transaction.gas)).toBeLessThanOrEqual(7_000_000n);
      const a = await f.bench.reserve(p.id);
      const hash = `0x${(operation + 1).toString(16).padStart(64, '0')}` as Hex;
      await f.bench.attachHash(a.id, hash);
      const { actual, receipt } = f.mine(a);
      Object.assign(actual, { hash, type: '0x2', gas: '0x88449e', gasPrice: '0x1312d01',
        maxFeePerGas: '0x19bfcc1', maxPriorityFeePerGas: '0x1' });
      Object.assign(receipt, { transactionHash: hash, gasUsed: '0x53cd3c', effectiveGasPrice: actual.gasPrice });
      await f.bench.reconcile();
      expect(f.bench.context().unresolved).toBeNull();
      expect(f.bench.context().maxGas).toBe('7000000');
      expect(f.bench.context().attempts.at(-1)?.minedEnvelope?.settledWithinReservation).toBe(true);
    }
    expect(f.bench.context().attempts.filter(a => a.status === 'confirmed')).toHaveLength(ops.length);
    expect(await f.bench.prepareNext()).toMatchObject({ complete: true });
    f.setEstimate(7_000_000n); f.next(0);
    await expect(f.prepare()).rejects.toThrow('disappeared');
    const restarted = fixture(structuredClone(f.writes.at(-1)!));
    expect(restarted.bench.context().reservedWei).toBe(f.bench.context().reservedWei);
  });
  it('does not accept a settled exception when actual fees or restored evidence exceed the original reservation', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await f.bench.attachHash(a.id, txHash);
    const { actual, receipt } = f.mine(a);
    Object.assign(actual, { gas: '0x88449e', gasPrice: '0x1500000' });
    receipt.effectiveGasPrice = actual.gasPrice;
    await expect(f.bench.reconcile()).rejects.toThrow('budget');
    actual.gasPrice = a.transaction.gasPrice; receipt.effectiveGasPrice = actual.gasPrice;
    await f.bench.reconcile();
    const saved = structuredClone(f.writes.at(-1)!);
    saved.attempts[0].gasUsed = (BigInt(a.transaction.gas) + 1n).toString();
    expect(() => fixture(saved)).toThrow('Invalid mined fee envelope');
    const gas = fixture(); gas.setEstimate(7_000_000n);
    await expect(gas.prepare()).rejects.toThrow('estimate exceeds');
  });
  it.each([false, true])('compares critical RPC fields despite operator metadata differences (conflict=%s)', async conflict => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await f.bench.attachHash(a.id, txHash);
    const { actual, receipt } = f.mine(a);
    const rpc = new StrictRpc(f.rpc.sources, async (source, method) => {
      const result = { ...(method === 'eth_getTransactionByHash' ? actual : receipt) };
      if (source.operator === 'b') {
        result.operatorMetadata = 'extra fields from another node implementation';
        if (conflict && method === 'eth_getTransactionByHash') result.input = '0x00';
      }
      return result;
    });
    vi.mocked(f.rpc.request).mockImplementation(rpc.request.bind(rpc));
    if (conflict) {
      await expect(f.bench.reconcile()).rejects.toThrow('disagree');
      expect(f.bench.context().unresolved).toBe(a.id);
    } else {
      await f.bench.reconcile();
      expect(f.bench.context().unresolved).toBeNull();
    }
  });
  it.each(['input', 'from', 'to', 'value', 'nonce', 'gas', 'gasPrice', 'chainId', 'blockHash'])(
    'rejects changed mined %s and keeps the request unresolved', async key => {
      const f = fixture(); await f.authorize();
      const a = await f.bench.reserve((await f.prepare()).id);
      await f.bench.attachHash(a.id, txHash);
      const { actual } = f.mine(a);
      actual[key] = key === 'input' ? '0x00' : key === 'from' || key === 'to' ? container : '0x1';
      await expect(f.bench.reconcile()).rejects.toThrow();
      expect(f.bench.context().unresolved).toBe(a.id);
    });
  it.each(['status', 'effectiveGasPrice', 'gasUsed', 'transactionHash', 'blockNumber', 'blockHash'])(
    'rejects mismatched receipt %s', async key => {
      const f = fixture(); await f.authorize();
      const a = await f.bench.reserve((await f.prepare()).id);
      await f.bench.attachHash(a.id, txHash);
      const { receipt } = f.mine(a);
      receipt[key] = '0xff';
      await expect(f.bench.reconcile()).rejects.toThrow();
      expect(f.bench.context().unresolved).toBe(a.id);
    });
  it('does not clear a missing receipt, an RPC disagreement or a young block', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await f.bench.attachHash(a.id, txHash);
    await expect(f.bench.reconcile()).rejects.toThrow('not confirmed');
    f.mine(a);
    vi.mocked(f.rpc.pin).mockResolvedValueOnce({ ...block, number: '0xf' });
    await expect(f.bench.reconcile()).rejects.toThrow('stable');
    vi.mocked(f.rpc.request).mockRejectedValueOnce(new Error('RPC conflict'));
    await expect(f.bench.reconcile()).rejects.toThrow('RPC conflict');
    expect(f.bench.context().unresolved).toBe(a.id);
  });
  it('requires resulting file bytes and stops if confirmed data later disappears', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await f.bench.attachHash(a.id, txHash); f.mine(a); f.next(0);
    await expect(f.bench.reconcile()).rejects.toThrow('matching publication bytes');
    f.next(1); await f.bench.reconcile(); f.next(0);
    await expect(f.prepare()).rejects.toThrow('disappeared');
  });
  it('requires a fresh preview after fee, nonce or gas increases and never reserves changed calldata', async () => {
    for (const change of ['price', 'gas', 'operation']) {
      const f = fixture(); await f.authorize(); const p = await f.prepare();
      if (change === 'price') f.setPrice(22_000_000n);
      if (change === 'gas') f.setEstimate(101_000n);
      if (change === 'operation') f.next(1);
      await expect(f.bench.reserve(p.id)).rejects.toThrow('changed');
      expect(f.journal.attempts).toHaveLength(0);
    }
  });
  it('rejects expired previews, expired consent, pending transactions and fee ceiling breaches', async () => {
    const f = fixture(); await f.authorize();
    const p = await f.prepare(); f.advance(180_001);
    await expect(f.bench.reserve(p.id)).rejects.toThrow('expired');
    const p2 = await f.prepare(); f.advance(3_600_001);
    await expect(f.bench.reserve(p2.id)).rejects.toThrow('expired');
    const pending = fixture(); pending.pending();
    await expect(pending.prepare()).rejects.toThrow('pending');
    const fee = fixture(); fee.setPrice(30_000_001n);
    await expect(fee.prepare()).rejects.toThrow('price exceeds');
    const gas = fixture(); gas.setEstimate(7_000_000n);
    await expect(gas.prepare()).rejects.toThrow('estimate exceeds');
  });
  it('reserves an unchanged transaction after a migration recheck lasting more than 30 seconds', async () => {
    const f = fixture(); await f.authorize();
    const p = await f.prepare();
    vi.mocked(resumePublication).mockImplementationOnce(async () => {
      f.advance(45_000);
      return { schemaVersion: 1, status: 'UNSIGNED_RESUME_PLAN_ONLY', container, block,
        manifestSha256: publication.manifestSha256, checked: [], transactions: ops,
        transactionCount: ops.length, scope: 'Slow migration readback fixture' };
    });
    const reservation = await f.bench.reserve(p.id);
    expect(reservation.transaction).toEqual(p.transaction);
    expect(f.journal.attempts).toHaveLength(1);
    expect(f.writes.at(-1)?.attempts[0]).toEqual(reservation);
  });
  it('still refuses to reserve when the bounded preview expires during recheck', async () => {
    const f = fixture(); await f.authorize();
    const p = await f.prepare();
    vi.mocked(resumePublication).mockImplementationOnce(async () => {
      f.advance(180_001);
      return { schemaVersion: 1, status: 'UNSIGNED_RESUME_PLAN_ONLY', container, block,
        manifestSha256: publication.manifestSha256, checked: [], transactions: ops,
        transactionCount: ops.length, scope: 'Expired migration fixture' };
    });
    await expect(f.bench.reserve(p.id)).rejects.toThrow('expired during recheck');
    expect(f.journal.attempts).toHaveLength(0);
  });
  it('faults closed on journal disk errors before releasing any transaction', async () => {
    const f = fixture(); await f.authorize(); const p = await f.prepare(); f.failSave();
    await expect(f.bench.reserve(p.id)).rejects.toThrow('disk full');
    await expect(f.bench.prepareNext()).rejects.toThrow('Journal write failed');
  });
  it('does not accept another attempt id, malformed hash or a different attached hash', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await expect(f.bench.attachHash(a.id, '0x01')).rejects.toThrow('hash');
    await expect(f.bench.attachHash('other', txHash)).rejects.toThrow('unresolved');
    await f.bench.attachHash(a.id, txHash);
    await expect(f.bench.attachHash(a.id, `0x${'ff'.repeat(32)}`)).rejects.toThrow('unresolved');
  });
  it('records explicit wallet cancellation without refunding budget and reserves the same nonce again', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    const budget = f.bench.context().reservedWei;
    await expect(f.bench.acknowledgeCancellation(a.id, 'assume cancelled')).rejects.toThrow('Explicit');
    await f.bench.acknowledgeCancellation(a.id, 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE');
    expect(f.bench.context().attempts[0].status).toBe('cancelled-by-user');
    expect(f.bench.context().reservedWei).toBe(budget);
    const restarted = fixture(structuredClone(f.journal));
    const next = await restarted.bench.reserve((await restarted.prepare()).id);
    expect(next.transaction.nonce).toBe(a.transaction.nonce);
    expect(next.operation).toBe(a.operation);
  });
  it('refuses cancellation when a hash is known or pending nonce has advanced', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    f.pending();
    await expect(f.bench.acknowledgeCancellation(a.id, 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE'))
      .rejects.toThrow('pending');
    await f.bench.attachHash(a.id, txHash);
    await expect(f.bench.acknowledgeCancellation(a.id, 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE'))
      .rejects.toThrow('hashed');
    expect(f.bench.context().unresolved).toBe(a.id);
  });
  it('rejects simultaneous actions while a chain check is running', async () => {
    const f = fixture();
    let release!: () => void;
    vi.mocked(resumePublication).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return { transactions: ops, block } as Awaited<ReturnType<typeof resumePublication>>;
    });
    const preparing = f.prepare();
    await Promise.resolve(); await Promise.resolve();
    await expect(f.authorize()).rejects.toThrow('already running');
    release(); await preparing;
  });
  it('runs full readback when files are complete without producing another transaction', async () => {
    const f = fixture(); f.next(ops.length);
    expect(await f.bench.prepareNext()).toMatchObject({ complete: true, readback: { containerLive: false } });
    expect(verifyPublication).toHaveBeenCalledWith(f.rpc, container, publication, publication.manifestSha256);
    expect(f.journal.attempts).toHaveLength(0);
  });
  it('checks all bytes once for activation and does not run a duplicate resume scan', async () => {
    const f = fixture();
    expect(await f.bench.verifyCompleted()).toMatchObject({ containerLive: false });
    expect(verifyPublication).toHaveBeenCalledWith(f.rpc, container, publication, publication.manifestSha256);
    expect(resumePublication).not.toHaveBeenCalled();
    expect(f.journal.attempts).toHaveLength(0);
    vi.mocked(verifyPublication).mockRejectedValueOnce(new Error('Published bytes mismatch'));
    await expect(f.bench.verifyCompleted()).rejects.toThrow('bytes mismatch');
  });
  it('blocks activation readback while an upload request is unresolved or history changed', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    await expect(f.bench.verifyCompleted()).rejects.toThrow('pending upload');
    await f.bench.attachHash(a.id, txHash); f.mine(a); await f.bench.reconcile();
    vi.mocked(f.rpc.assertBlock).mockRejectedValueOnce(new Error('Snapshot block changed'));
    await expect(f.bench.verifyCompleted()).rejects.toThrow('block changed');
  });
  it('binds budget, code pins and manifest to a journal and rejects corrupt persisted entries', async () => {
    const f = fixture(); await f.authorize();
    const a = await f.bench.reserve((await f.prepare()).id);
    for (const patch of [{ contextId: 'wrong' }, { schemaVersion: 2 }]) {
      expect(() => fixture({ ...structuredClone(f.journal), ...patch } as UploadJournal)).toThrow();
    }
    for (const patch of [
      { transaction: { ...a.transaction, to: publisher } },
      { transaction: { ...a.transaction, gas: '0x0' } },
      { status: 'confirmed' }, { operation: 999 },
    ]) {
      expect(() => fixture({ ...structuredClone(f.journal),
        attempts: [{ ...a, ...patch } as UploadAttempt] })).toThrow();
    }
    expect(PublicationWorkbench.contextId({ ...profile, maxFeePerGasWei: '1' }, publication.manifestSha256)).not.toBe(f.bench.contextId);
  });
});
