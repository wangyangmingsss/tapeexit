import { randomUUID } from 'node:crypto';
import { getAddress, type Hex } from 'viem';
import { recoverAuthorizationAddress } from 'viem/utils';
import { StrictRpc, type Block } from '../src/core/rpc';
import { digest, REGISTRY, encodePublishFile, fallbackTransaction, type loadPublication } from './publish-core';
import { inspectPublication, parsePublishProfile, type PublishProfile } from './operations-core';
import { resumePublication } from './resume-publication-core';
import { verifyPublication } from './verify-publication-core';
import { batchData, BATCH_CONSENT, BATCH_IMPLEMENTATION, checkBatchCode } from './publication-batch';
import { resumePublicationUpdate, updateRemovals } from './resume-publication-update';

type Publication = Awaited<ReturnType<typeof loadPublication>>;
export interface UploadTransaction {
  from: string; to: string; data: Hex; value: '0x0'; chainId: '0xc4';
  gas: Hex; gasPrice: Hex; nonce: Hex;
}
export interface UploadAttempt {
  id: string; operation: number; createdAt: number; transaction: UploadTransaction;
  status: 'reserved' | 'confirmed' | 'reverted' | 'cancelled-by-user'; hash?: Hex; cancellationAcknowledgedAt?: number;
  block?: Block; gasUsed?: string; effectiveGasPriceWei?: string;
  minedEnvelope?: { gas: string; maximumGasPriceWei: string; settledWithinReservation?: true };
  batch?: { operations: number[]; requestId: string; bundleId?: string; consent: typeof BATCH_CONSENT;
    consentAt: number; needsUpgrade: boolean; offchainFailure?: true };
}
export interface UploadJournal {
  schemaVersion: 1; contextId: string;
  authorization: null | { expiresAt: number; maximumWei: string; grantedAt: number };
  attempts: UploadAttempt[];
  walletCapabilities?: WalletCapabilityReport;
}
const capabilityOutcomes = ['reported', 'not-reported', 'method-unavailable', 'invalid-response', 'timeout', 'error'] as const;
type CapabilityOutcome = typeof capabilityOutcomes[number];
type AtomicStatus = 'supported' | 'ready' | 'unsupported';
export interface WalletCapabilityReport {
  publisher: string; chainId: 196; checkedAt: number;
  outcome: CapabilityOutcome; atomicStatus: AtomicStatus | null;
}
function validCapabilityResult(outcome: unknown, atomicStatus: unknown) {
  return capabilityOutcomes.includes(outcome as CapabilityOutcome) &&
    (outcome === 'reported' ? ['supported', 'ready', 'unsupported'].includes(atomicStatus as string) : atomicStatus === null);
}
export interface JournalStore { save(journal: UploadJournal): Promise<void> }
export interface UploadPreview {
  id: string; expiresAt: number; operation: number; remaining: number; file: string; chunk: number;
  maximumCostWei: string; block: Block; transaction: UploadTransaction;
}
const hex = (n: bigint): Hex => `0x${n.toString(16)}`;
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value))
    throw new Error('Invalid chain quantity');
  return BigInt(value);
}
function hash(value: unknown): asserts value is Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new Error('Invalid transaction hash');
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fields = (keys: string[]) => (value: Record<string, unknown> | null) =>
  value === null ? null : Object.fromEntries(keys.map(key => [key, value[key] ?? null]));

// The server is a read-only RPC client. Only the user's browser holds a provider.
export class PublicationWorkbench {
  readonly profile: PublishProfile;
  readonly contextId: string;
  private readonly operations;
  private preview: UploadPreview | null = null;
  private busy = false;
  private fault = false;
  constructor(private rpc: StrictRpc, input: unknown, private publication: Publication,
    private journal: UploadJournal, private store: JournalStore, private now = Date.now,
    private previousPublication?: Publication) {
    this.profile = parsePublishProfile(input);
    if (!!this.profile.previousManifestSha256 !== !!previousPublication ||
        previousPublication && previousPublication.manifestSha256 !== this.profile.previousManifestSha256)
      throw new Error('Migration requires the exact trusted previous publication');
    this.operations = [...(previousPublication ? updateRemovals(this.profile.container, publication, previousPublication) : []),
      ...publication.contents.flatMap(c => encodePublishFile(this.profile.container, c.file, c.bytes)),
      fallbackTransaction(this.profile.container)];
    if (!this.operations.length || this.operations.length > 1000) throw new Error('Unbounded upload plan');
    const p = this.profile;
    const bound = BigInt(p.maxGasPerTransaction) * BigInt(p.maxFeePerGasWei) * BigInt(this.operations.length);
    if (bound > BigInt(p.maxUploadCostWei)) throw new Error('Plan exceeds total upload budget');
    this.contextId = PublicationWorkbench.contextId(input, publication.manifestSha256);
    this.validateJournal();
  }
  static contextId(input: unknown, manifestSha256: string) {
    const p = parsePublishProfile(input);
    if (!/^[a-f0-9]{64}$/.test(manifestSha256)) throw new Error('Invalid manifest digest');
    return digest(Buffer.from(JSON.stringify({ manifestSha256, publisher: p.publisher, container: p.container,
      processorIndex: p.processorIndex, circuitId: p.circuitId,
      maxGasPerTransaction: p.maxGasPerTransaction, maxFeePerGasWei: p.maxFeePerGasWei,
      maxUploadCostWei: p.maxUploadCostWei,
      ...(p.previousManifestSha256 ? { previousManifestSha256: p.previousManifestSha256 } : {}),
      codeHashes: Object.entries(p.expectedCodeHashes).sort(([a], [b]) => a.localeCompare(b)) })));
  }
  private validateJournal() {
    const j = this.journal, p = this.profile;
    if (j.schemaVersion !== 1 || j.contextId !== this.contextId || !Array.isArray(j.attempts) || j.attempts.length > 1000)
      throw new Error('Upload journal does not match release/profile');
    const report = j.walletCapabilities;
    if (report !== undefined && (!report || report.publisher !== p.publisher || report.chainId !== 196 ||
        !Number.isSafeInteger(report.checkedAt) || report.checkedAt < 0 ||
        !validCapabilityResult(report.outcome, report.atomicStatus)))
      throw new Error('Invalid wallet capability observation');
    const a = j.authorization;
    if (a !== null && (!a || a.maximumWei !== p.maxUploadCostWei ||
        !Number.isSafeInteger(a.grantedAt) || !Number.isSafeInteger(a.expiresAt) ||
        a.expiresAt <= a.grantedAt || a.expiresAt - a.grantedAt > 3_600_000))
      throw new Error('Invalid persisted fee authorization');
    const ids = new Set(), hashes = new Set();
    for (const [index, attempt] of j.attempts.entries()) {
      const tx = attempt.transaction, op = this.operations[attempt.operation];
      const batch = attempt.batch;
      if (batch && (!Array.isArray(batch.operations) || batch.operations.length < 1 || batch.operations.length > 2 ||
          batch.operations[0] !== attempt.operation ||
          batch.operations.some((n, i) => !Number.isSafeInteger(n) || !this.operations[n] || (i > 0 && n !== batch.operations[i - 1] + 1)) ||
          !/^[0-9a-f-]{36}$/.test(batch.requestId) || batch.consent !== BATCH_CONSENT ||
          !Number.isSafeInteger(batch.consentAt) || batch.consentAt !== attempt.createdAt ||
          typeof batch.needsUpgrade !== 'boolean' ||
          (batch.bundleId !== undefined && !this.validBundleId(batch.bundleId)) ||
          (batch.offchainFailure !== undefined && batch.offchainFailure !== true)))
        throw new Error('Invalid persisted batch reservation');
      const expectedData = batch ? batchData(batch.operations.map(n => this.operations[n])) : op?.data;
      if (!attempt || typeof attempt.id !== 'string' || ids.has(attempt.id) || !op ||
          !Number.isSafeInteger(attempt.operation) || !Number.isSafeInteger(attempt.createdAt) ||
          !['reserved', 'confirmed', 'reverted', 'cancelled-by-user'].includes(attempt.status) ||
          !tx || tx.from !== p.publisher || tx.to !== (batch ? p.publisher : REGISTRY) || tx.data !== expectedData ||
          tx.value !== '0x0' || tx.chainId !== '0xc4' ||
          quantity(tx.gas) === 0n || quantity(tx.gas) > this.gasCap(attempt) ||
          quantity(tx.gasPrice) > BigInt(p.maxFeePerGasWei) || quantity(tx.nonce) >= 1n << 64n ||
          (attempt.status === 'reserved' && index !== j.attempts.length - 1))
        throw new Error('Invalid or unresolved upload journal entry');
      ids.add(attempt.id);
      if (attempt.hash) {
        hash(attempt.hash);
        if (hashes.has(attempt.hash.toLowerCase())) throw new Error('Repeated journal transaction hash');
        hashes.add(attempt.hash.toLowerCase());
      }
      if (attempt.status === 'cancelled-by-user') {
        if (attempt.hash || attempt.block || !Number.isSafeInteger(attempt.cancellationAcknowledgedAt))
          throw new Error('Invalid user cancellation record');
      } else if (attempt.status !== 'reserved') {
        if (!attempt.hash || !attempt.block || !/^0x[0-9a-f]{64}$/i.test(attempt.block.hash) ||
            quantity(attempt.block.number) < 0n || quantity(attempt.block.timestamp) < 0n ||
            typeof attempt.gasUsed !== 'string' || !/^[1-9][0-9]*$/.test(attempt.gasUsed) ||
            BigInt(attempt.gasUsed) < 21_000n ||
            BigInt(attempt.gasUsed) > BigInt(attempt.minedEnvelope?.gas ?? quantity(tx.gas)) ||
            !attempt.effectiveGasPriceWei || !/^[0-9]+$/.test(attempt.effectiveGasPriceWei) ||
            BigInt(attempt.effectiveGasPriceWei) > BigInt(attempt.minedEnvelope?.maximumGasPriceWei ?? quantity(tx.gasPrice)))
          throw new Error('Missing checked transaction evidence');
      }
      if (attempt.minedEnvelope) {
        const e = attempt.minedEnvelope;
        if (!['confirmed', 'reverted'].includes(attempt.status) ||
            !/^[1-9][0-9]*$/.test(e.gas) || !/^[0-9]+$/.test(e.maximumGasPriceWei) ||
            (e.settledWithinReservation !== undefined && e.settledWithinReservation !== true) ||
            (e.settledWithinReservation === true
              ? BigInt(attempt.gasUsed!) > quantity(tx.gas) ||
                BigInt(attempt.effectiveGasPriceWei!) > quantity(tx.gasPrice)
              : BigInt(e.gas) > this.gasCap(attempt) ||
                BigInt(e.maximumGasPriceWei) > BigInt(p.maxFeePerGasWei)))
          throw new Error('Invalid mined fee envelope');
      }
    }
    if (this.reservedCost() > BigInt(p.maxUploadCostWei)) throw new Error('Persisted upload budget exceeded');
  }
  private reservedCost() {
    // Never refund a reservation, even after a revert. This remains conservative across restarts.
    return this.journal.attempts.reduce((sum, a) => {
      const reserved = quantity(a.transaction.gas) * quantity(a.transaction.gasPrice);
      const mined = a.minedEnvelope && !a.minedEnvelope.settledWithinReservation
        ? BigInt(a.minedEnvelope.gas) * BigInt(a.minedEnvelope.maximumGasPriceWei) : 0n;
      return sum + (mined > reserved ? mined : reserved);
    }, 0n);
  }
  private unresolved() { return this.journal.attempts.find(a => a.status === 'reserved'); }
  private gasCap(a: UploadAttempt) {
    return BigInt(this.profile.maxGasPerTransaction) * BigInt(a.batch?.operations.length ?? 1);
  }
  private validBundleId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
  }
  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.busy || this.fault) throw new Error(this.fault ? 'Journal write failed; restart and inspect journal' : 'Upload check already running');
    this.busy = true;
    try { return await run(); } finally { this.busy = false; }
  }
  private async persist() {
    try { await this.store.save(structuredClone(this.journal)); }
    catch (error) { this.fault = true; throw error; }
  }
  context() {
    return {
      schemaVersion: 1, contextId: this.contextId, chainId: 196, publisher: this.profile.publisher,
      container: this.profile.container, registry: REGISTRY, manifestSha256: this.publication.manifestSha256,
      fileCount: this.publication.contents.length, totalOperations: this.operations.length,
      totalBytes: this.publication.contents.reduce((sum, c) => sum + c.bytes.length, 0),
      maximumWei: this.profile.maxUploadCostWei, maxGas: this.profile.maxGasPerTransaction,
      maxGasPriceWei: this.profile.maxFeePerGasWei, reservedWei: this.reservedCost().toString(),
      authorization: this.journal.authorization, attempts: structuredClone(this.journal.attempts),
      unresolved: this.unresolved()?.id ?? null,
      uploadMode: 'single-transaction',
      migration: this.previousPublication ? {
        previousManifestSha256: this.previousPublication.manifestSha256,
        removalCount: updateRemovals(this.profile.container, this.publication, this.previousPublication).length,
        siteMayBeUnavailableDuringUpdate: true,
      } : null,
      scope: 'Upload registry calls only. No activation, token approval, liquidity or app funds operations. ' +
        'Observed code pins are not an independent security review. EVM gas cap excludes chain-specific fees.',
    };
  }
  authorize(contextId: unknown, maximumWei: unknown) {
    return this.exclusive(async () => {
      if (contextId !== this.contextId || maximumWei !== this.profile.maxUploadCostWei)
        throw new Error('Fee consent does not match this release and budget');
      if (this.unresolved()) throw new Error('Resolve the previous wallet request before authorization');
      this.journal.authorization = { grantedAt: this.now(), expiresAt: this.now() + 3_600_000,
        maximumWei: this.profile.maxUploadCostWei };
      await this.persist();
      return this.context();
    });
  }
  private authorized() {
    if (!this.journal.authorization || this.journal.authorization.expiresAt <= this.now())
      throw new Error('Explicit fee consent is missing or expired');
  }
  private async checkHistory() {
    for (const a of this.journal.attempts) if (a.block) await this.rpc.assertBlock(a.block);
  }
  verifyCompleted() {
    return this.exclusive(async () => {
      if (this.unresolved()) throw new Error('Resolve pending upload before activation');
      const blocks = this.journal.attempts.flatMap(a => a.block ? [a.block] : []);
      // Activation needs one full readback, not both a resume scan and a full readback.
      // Bound independent history requests and wait for every in-flight check on failure.
      for (let i = 0; i < blocks.length; i += 4) {
        const checks = await Promise.allSettled(blocks.slice(i, i + 4).map(b => this.rpc.assertBlock(b)));
        for (const check of checks) if (check.status === 'rejected') throw check.reason;
      }
      return verifyPublication(this.rpc, this.profile.container, this.publication, this.publication.manifestSha256);
    });
  }
  private async continuation() {
    return this.previousPublication
      ? await resumePublicationUpdate(this.rpc, this.profile.container, this.publication,
        this.previousPublication, this.profile.previousManifestSha256!)
      : await resumePublication(this.rpc, this.profile.container, this.publication);
  }
  private async prepare(): Promise<UploadPreview | { complete: true; readback: unknown }> {
    if (this.unresolved()) throw new Error('Previous wallet request unresolved; do not resend');
    await this.checkHistory();
    const plan = await this.continuation();
    for (const a of this.journal.attempts) {
      if (a.status === 'confirmed' && (a.batch?.operations ?? [a.operation])
        .some(n => plan.transactions.some(op => equal(op, this.operations[n]))))
        throw new Error('Previously confirmed publication bytes disappeared; stopped');
    }
    if (!plan.transactions.length) {
      const readback = await verifyPublication(this.rpc, this.profile.container, this.publication, this.publication.manifestSha256);
      return { complete: true, readback };
    }
    const identity = await inspectPublication(this.rpc, this.profile, plan.transactions);
    const op = plan.transactions[0];
    const operation = this.operations.findIndex(item => equal(item, op));
    if (operation < 0) throw new Error('Unexpected continuation operation');
    const [price, latest, pending] = await Promise.all([
      this.rpc.gasPrice(),
      this.rpc.request<Hex>('eth_getTransactionCount', [this.profile.publisher, 'latest']),
      this.rpc.request<Hex>('eth_getTransactionCount', [this.profile.publisher, 'pending']),
    ]);
    if (quantity(latest) !== quantity(pending)) throw new Error('Publisher has pending transactions; resolve them first');
    if (price > BigInt(this.profile.maxFeePerGasWei)) throw new Error('Current gas price exceeds cap');
    const base = { from: this.profile.publisher, to: REGISTRY, data: op.data, value: '0x0' as const };
    await this.rpc.request('eth_call', [base, plan.block.number]);
    const estimate = await this.rpc.estimate({ ...base, gasPrice: hex(price), nonce: latest });
    const gas = (estimate * 120n + 99n) / 100n;
    if (gas > BigInt(this.profile.maxGasPerTransaction)) throw new Error('Current gas estimate exceeds cap');
    const cost = gas * price;
    if (this.reservedCost() + cost > BigInt(this.profile.maxUploadCostWei)) throw new Error('Remaining upload budget insufficient');
    await this.rpc.assertBlock(plan.block);
    await this.rpc.assertBlock(identity.block);
    return { id: randomUUID(), expiresAt: this.now() + 30_000, operation, remaining: plan.transactions.length,
      file: op.file, chunk: op.chunk, maximumCostWei: cost.toString(), block: plan.block,
      transaction: { ...base, chainId: '0xc4', nonce: latest, gas: hex(gas), gasPrice: hex(price) } };
  }
  prepareNext() {
    return this.exclusive(async () => {
      this.preview = null;
      const result = await this.prepare();
      if (!('complete' in result)) this.preview = result;
      return result;
    });
  }
  reserve(previewId: unknown) {
    return this.exclusive(async () => {
      this.authorized();
      const previous = this.preview;
      this.preview = null;
      if (!previous || previewId !== previous.id || previous.expiresAt <= this.now())
        throw new Error('Upload preview expired; refresh before signing');
      const fresh = await this.prepare();
      if ('complete' in fresh || fresh.operation !== previous.operation ||
          fresh.transaction.nonce !== previous.transaction.nonce ||
          fresh.transaction.data !== previous.transaction.data ||
          quantity(fresh.transaction.gas) > quantity(previous.transaction.gas) ||
          quantity(fresh.transaction.gasPrice) > quantity(previous.transaction.gasPrice))
        throw new Error('Upload state or quote changed; refresh before signing');
      this.authorized();
      if (this.now() >= previous.expiresAt) throw new Error('Upload preview expired during recheck');
      const attempt: UploadAttempt = { id: randomUUID(), operation: previous.operation, createdAt: this.now(),
        status: 'reserved', transaction: previous.transaction };
      this.journal.attempts.push(attempt);
      await this.persist();
      return structuredClone(attempt);
    });
  }
  recordBundle(attemptId: unknown, bundleId: unknown) {
    return this.exclusive(async () => {
      const a = this.unresolved();
      if (!a?.batch || a.id !== attemptId || !this.validBundleId(bundleId) ||
          (a.batch.bundleId && a.batch.bundleId !== bundleId))
        throw new Error('Bundle ID does not match pending batch');
      a.batch.bundleId = bundleId;
      await this.persist(); return this.context();
    });
  }
  recordBatchFailure(attemptId: unknown, reason: unknown) {
    return this.exclusive(async () => {
      const a = this.unresolved();
      if (!a?.batch || a.id !== attemptId || a.hash ||
          !['USER_REJECTED_4001', 'WALLET_REJECTED_UPGRADE_5750', 'WALLET_STATUS_400', 'NOT_SUBMITTED'].includes(String(reason)))
        throw new Error('Explicit offchain batch failure required');
      a.batch.offchainFailure = true;
      await this.persist(); return this.context();
    });
  }
  attachHash(attemptId: unknown, transactionHash: unknown) {
    return this.exclusive(async () => {
      hash(transactionHash);
      const a = this.unresolved();
      const normalizedHash = transactionHash.toLowerCase() as Hex;
      if (!a || a.id !== attemptId || a.hash && a.hash.toLowerCase() !== normalizedHash)
        throw new Error('Transaction hash does not match unresolved attempt');
      a.hash = normalizedHash;
      await this.persist();
      return this.context();
    });
  }
  acknowledgeCancellation(attemptId: unknown, acknowledgement: unknown) {
    return this.exclusive(async () => {
      const a = this.unresolved();
      if (!a || a.id !== attemptId || a.hash || acknowledgement !== 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE')
        throw new Error('Explicit cancellation acknowledgement required; hashed transactions must be reconciled');
      if (a.batch && !a.batch.offchainFailure) throw new Error('Unknown batch may still execute; recover wallet status before cancellation');
      await this.rpc.checkChain(196);
      const [latest, pending] = await Promise.all([
        this.rpc.request<Hex>('eth_getTransactionCount', [this.profile.publisher, 'latest']),
        this.rpc.request<Hex>('eth_getTransactionCount', [this.profile.publisher, 'pending']),
      ]);
      if (quantity(latest) !== quantity(a.transaction.nonce) || quantity(pending) !== quantity(latest))
        throw new Error('Nonce changed or publisher has pending transactions; inspect the wallet first');
      // This records the user's attestation, not proof of absence from every mempool.
      // A subsequent reservation rechecks nonce and exact bytes; its explicit nonce
      // also prevents both the old and replacement request being mined separately.
      a.status = 'cancelled-by-user'; a.cancellationAcknowledgedAt = this.now();
      await this.persist();
      return this.context();
    });
  }
  reconcile() {
    return this.exclusive(async () => {
      const a = this.unresolved();
      if (!a?.hash) throw new Error('Supply the wallet transaction hash for the unresolved request');
      await this.rpc.checkChain(196);
      const [receipt, actual] = await Promise.all([
        this.rpc.request<Record<string, unknown> | null>('eth_getTransactionReceipt', [a.hash],
          fields(['status', 'transactionHash', 'blockNumber', 'blockHash', 'gasUsed', 'effectiveGasPrice'])),
        this.rpc.request<Record<string, unknown> | null>('eth_getTransactionByHash', [a.hash],
          fields(['hash', 'from', 'to', 'input', 'value', 'nonce', 'chainId', 'gas', 'gasPrice',
            'type', 'maxFeePerGas', 'maxPriorityFeePerGas', 'blockNumber', 'blockHash', 'authorizationList'])),
      ]);
      if (!receipt || !actual) throw new Error('Transaction not confirmed by both RPC sources; keep waiting');
      const tx = a.transaction;
      // Extension wallets may convert a legacy request to EIP-1559 and re-estimate gas.
      // A settled receipt can prove actual usage remained inside the original
      // reservation even when the wallet increased an unused maximum.
      const gas = quantity(actual.gas), price = quantity(actual.gasPrice);
      const feeMarket = actual.type === '0x2' || actual.type === '0x4';
      const maximumPrice = feeMarket ? quantity(actual.maxFeePerGas) : price;
      const originalCost = quantity(tx.gas) * quantity(tx.gasPrice);
      const settledWithinReservation = quantity(receipt.gasUsed) <= quantity(tx.gas) &&
        price <= quantity(tx.gasPrice);
      const outsideEnvelope = gas > this.gasCap(a) ||
        maximumPrice > BigInt(this.profile.maxFeePerGasWei);
      const settledException = outsideEnvelope && settledWithinReservation;
      const minedCost = settledException ? originalCost : gas * maximumPrice;
      if (![undefined, '0x0', '0x1', '0x2', ...(a.batch ? ['0x4'] : [])].includes(actual.type as string | undefined) ||
          (outsideEnvelope && !settledWithinReservation) || price > maximumPrice ||
          (feeMarket && quantity(actual.maxPriorityFeePerGas) > maximumPrice) ||
          this.reservedCost() + (minedCost > originalCost ? minedCost - originalCost : 0n) > BigInt(this.profile.maxUploadCostWei))
        throw new Error('Mined wallet fee envelope exceeds authorized upload budget; stopped');
      if (!['0x0', '0x1'].includes(String(receipt.status)) || receipt.transactionHash !== a.hash ||
          actual.hash !== a.hash || typeof actual.from !== 'string' || getAddress(actual.from) !== tx.from ||
          typeof actual.to !== 'string' || getAddress(actual.to) !== tx.to || actual.input !== tx.data ||
          quantity(actual.value) !== 0n || (a.batch
            ? quantity(actual.nonce) < quantity(tx.nonce) || quantity(actual.nonce) > quantity(tx.nonce) + (a.batch.needsUpgrade ? 2n : 0n)
            : quantity(actual.nonce) !== quantity(tx.nonce)) ||
          quantity(actual.chainId) !== 196n ||
          actual.blockNumber !== receipt.blockNumber || actual.blockHash !== receipt.blockHash ||
          typeof receipt.blockNumber !== 'string' || !/^0x[0-9a-f]+$/i.test(receipt.blockNumber) ||
          quantity(receipt.gasUsed) < 21_000n || quantity(receipt.gasUsed) > gas ||
          quantity(receipt.effectiveGasPrice) !== price)
        throw new Error('Mined wallet transaction differs from reserved upload; stopped');
      const block = await this.rpc.block(receipt.blockNumber as Hex);
      const stable = await this.rpc.pin();
      if (block.hash !== receipt.blockHash || BigInt(stable.number) < BigInt(block.number))
        throw new Error('Transaction block is not yet stable in the two-source snapshot');
      if (a.batch) {
        await checkBatchCode(this.rpc, tx.from, block, false);
        if (actual.type === '0x4') {
          const auth = actual.authorizationList;
          if (!Array.isArray(auth) || auth.length !== 1) throw new Error('Unsupported batch authorization list');
          const item = auth[0] as Record<string, unknown>;
          if (typeof item.address !== 'string' || getAddress(item.address) !== BATCH_IMPLEMENTATION ||
              quantity(item.chainId) !== 196n || quantity(item.nonce) !== quantity(actual.nonce) + 1n)
            throw new Error('Batch authorization differs from pinned account upgrade');
          const signer = await recoverAuthorizationAddress({ authorization: {
            address: BATCH_IMPLEMENTATION, chainId: 196, nonce: Number(quantity(item.nonce)),
            r: item.r as Hex, s: item.s as Hex, yParity: Number(quantity(item.yParity)),
          } });
          if (getAddress(signer) !== tx.from) throw new Error('Batch authorization signer mismatch');
        }
      }
      await this.rpc.assertBlock(block);
      const continuation = await this.continuation();
      if (receipt.status === '0x1' && (a.batch?.operations ?? [a.operation])
        .some(n => continuation.transactions.some(item => equal(item, this.operations[n]))))
        throw new Error('Confirmed transaction did not produce matching publication bytes');
      await this.rpc.assertBlock(block);
      a.status = receipt.status === '0x1' ? 'confirmed' : 'reverted';
      a.block = block; a.gasUsed = quantity(receipt.gasUsed).toString();
      a.effectiveGasPriceWei = quantity(receipt.effectiveGasPrice).toString();
      a.minedEnvelope = { gas: gas.toString(), maximumGasPriceWei: maximumPrice.toString(),
        ...(settledException ? { settledWithinReservation: true as const } : {}) };
      await this.persist();
      return this.context();
    });
  }
}
