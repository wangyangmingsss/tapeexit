import { randomUUID } from 'node:crypto';
import { getAddress, type Hex } from 'viem';
import { StrictRpc, type Block } from '../src/core/rpc';
import { digest, REGISTRY, encodePublishFile, fallbackTransaction, type loadPublication } from './publish-core';
import { inspectPublication, parsePublishProfile, type PublishProfile } from './operations-core';
import { resumePublication } from './resume-publication-core';
import { verifyPublication } from './verify-publication-core';

type Publication = Awaited<ReturnType<typeof loadPublication>>;
export interface UploadTransaction {
  from: string; to: string; data: Hex; value: '0x0'; chainId: '0xc4';
  gas: Hex; gasPrice: Hex; nonce: Hex;
}
export interface UploadAttempt {
  id: string; operation: number; createdAt: number; transaction: UploadTransaction;
  status: 'reserved' | 'confirmed' | 'reverted' | 'cancelled-by-user'; hash?: Hex; cancellationAcknowledgedAt?: number;
  block?: Block; gasUsed?: string; effectiveGasPriceWei?: string;
  minedEnvelope?: { gas: string; maximumGasPriceWei: string };
}
export interface UploadJournal {
  schemaVersion: 1; contextId: string;
  authorization: null | { expiresAt: number; maximumWei: string; grantedAt: number };
  attempts: UploadAttempt[];
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
    private journal: UploadJournal, private store: JournalStore, private now = Date.now) {
    this.profile = parsePublishProfile(input);
    this.operations = [...publication.contents.flatMap(c => encodePublishFile(this.profile.container, c.file, c.bytes)),
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
      codeHashes: Object.entries(p.expectedCodeHashes).sort(([a], [b]) => a.localeCompare(b)) })));
  }
  private validateJournal() {
    const j = this.journal, p = this.profile;
    if (j.schemaVersion !== 1 || j.contextId !== this.contextId || !Array.isArray(j.attempts) || j.attempts.length > 1000)
      throw new Error('Upload journal does not match release/profile');
    const a = j.authorization;
    if (a !== null && (!a || a.maximumWei !== p.maxUploadCostWei ||
        !Number.isSafeInteger(a.grantedAt) || !Number.isSafeInteger(a.expiresAt) ||
        a.expiresAt <= a.grantedAt || a.expiresAt - a.grantedAt > 3_600_000))
      throw new Error('Invalid persisted fee authorization');
    const ids = new Set(), hashes = new Set();
    for (const [index, attempt] of j.attempts.entries()) {
      const tx = attempt.transaction, op = this.operations[attempt.operation];
      if (!attempt || typeof attempt.id !== 'string' || ids.has(attempt.id) || !op ||
          !Number.isSafeInteger(attempt.operation) || !Number.isSafeInteger(attempt.createdAt) ||
          !['reserved', 'confirmed', 'reverted', 'cancelled-by-user'].includes(attempt.status) ||
          !tx || tx.from !== p.publisher || tx.to !== REGISTRY || tx.data !== op.data ||
          tx.value !== '0x0' || tx.chainId !== '0xc4' ||
          quantity(tx.gas) === 0n || quantity(tx.gas) > BigInt(p.maxGasPerTransaction) ||
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
            BigInt(e.gas) > BigInt(p.maxGasPerTransaction) ||
            BigInt(e.maximumGasPriceWei) > BigInt(p.maxFeePerGasWei))
          throw new Error('Invalid mined fee envelope');
      }
    }
    if (this.reservedCost() > BigInt(p.maxUploadCostWei)) throw new Error('Persisted upload budget exceeded');
  }
  private reservedCost() {
    // Never refund a reservation, even after a revert. This remains conservative across restarts.
    return this.journal.attempts.reduce((sum, a) => {
      const reserved = quantity(a.transaction.gas) * quantity(a.transaction.gasPrice);
      const mined = a.minedEnvelope ? BigInt(a.minedEnvelope.gas) * BigInt(a.minedEnvelope.maximumGasPriceWei) : 0n;
      return sum + (mined > reserved ? mined : reserved);
    }, 0n);
  }
  private unresolved() { return this.journal.attempts.find(a => a.status === 'reserved'); }
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
  private async prepare(): Promise<UploadPreview | { complete: true; readback: unknown }> {
    if (this.unresolved()) throw new Error('Previous wallet request unresolved; do not resend');
    await this.checkHistory();
    const plan = await resumePublication(this.rpc, this.profile.container, this.publication);
    for (const a of this.journal.attempts) {
      if (a.status === 'confirmed' && plan.transactions.some(op => equal(op, this.operations[a.operation])))
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
            'type', 'maxFeePerGas', 'maxPriorityFeePerGas', 'blockNumber', 'blockHash'])),
      ]);
      if (!receipt || !actual) throw new Error('Transaction not confirmed by both RPC sources; keep waiting');
      const tx = a.transaction;
      // Extension wallets may convert a legacy request to EIP-1559 and re-estimate gas.
      // Check the mined envelope against consent and account for its full liability.
      const gas = quantity(actual.gas), price = quantity(actual.gasPrice);
      const maximumPrice = actual.type === '0x2' ? quantity(actual.maxFeePerGas) : price;
      const originalCost = quantity(tx.gas) * quantity(tx.gasPrice);
      const minedCost = gas * maximumPrice;
      if (![undefined, '0x0', '0x1', '0x2'].includes(actual.type as string | undefined) ||
          gas > BigInt(this.profile.maxGasPerTransaction) ||
          maximumPrice > BigInt(this.profile.maxFeePerGasWei) || price > maximumPrice ||
          (actual.type === '0x2' && quantity(actual.maxPriorityFeePerGas) > maximumPrice) ||
          this.reservedCost() + (minedCost > originalCost ? minedCost - originalCost : 0n) > BigInt(this.profile.maxUploadCostWei))
        throw new Error('Mined wallet fee envelope exceeds authorized upload budget; stopped');
      if (!['0x0', '0x1'].includes(String(receipt.status)) || receipt.transactionHash !== a.hash ||
          actual.hash !== a.hash || typeof actual.from !== 'string' || getAddress(actual.from) !== tx.from ||
          typeof actual.to !== 'string' || getAddress(actual.to) !== tx.to || actual.input !== tx.data ||
          quantity(actual.value) !== 0n || quantity(actual.nonce) !== quantity(tx.nonce) ||
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
      await this.rpc.assertBlock(block);
      const continuation = await resumePublication(this.rpc, this.profile.container, this.publication);
      const op = this.operations[a.operation];
      if (receipt.status === '0x1' && continuation.transactions.some(item => equal(item, op)))
        throw new Error('Confirmed transaction did not produce matching publication bytes');
      await this.rpc.assertBlock(block);
      a.status = receipt.status === '0x1' ? 'confirmed' : 'reverted';
      a.block = block; a.gasUsed = quantity(receipt.gasUsed).toString();
      a.effectiveGasPriceWei = quantity(receipt.effectiveGasPrice).toString();
      a.minedEnvelope = { gas: gas.toString(), maximumGasPriceWei: maximumPrice.toString() };
      await this.persist();
      return this.context();
    });
  }
}
