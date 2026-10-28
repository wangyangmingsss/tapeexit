import { randomUUID } from 'node:crypto';
import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, toHex, type Abi, type Hex } from 'viem';
import { StrictRpc, type Block } from '../src/core/rpc';
import { BINDING, digest, fallbackTransaction } from './publish-core';
import { inspectPublication } from './operations-core';
import type { PublicationWorkbench } from './publication-workbench-core';

export const activationAbi = parseAbi([
  'function monthlyFee() view returns (uint256)',
  'function isContainerLive(address) view returns (bool)',
  'function containerPaidUntil(address) view returns (uint40)',
  'function isLive(string,address) view returns (bool)',
  'function paidUntil(bytes32,address) view returns (uint40)',
  'function bind(string,address,uint256) payable',
]);
const GAS_CAP = 500_000n, PRICE_CAP = 30_000_000n, DURATION = 30n * 86400n;
export const ACTIVATION_CONSENT = 'ACTIVATE_EXACT_QUOTED_NAME_CONTAINER_30_DAYS';
const hex = (n: bigint): Hex => `0x${n.toString(16)}`;
function quantity(v: unknown): bigint {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v)) throw new Error('Invalid activation quantity');
  return BigInt(v);
}
function hash(v: unknown): asserts v is Hex {
  if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/i.test(v)) throw new Error('Invalid activation hash');
}
const fields = (keys: string[]) => (v: Record<string, unknown> | null) =>
  v === null ? null : Object.fromEntries(keys.map(k => [k, v[k] ?? null]));
interface ActivationTransaction {
  from: string; to: string; data: Hex; value: Hex; chainId: '0xc4'; gas: Hex; gasPrice: Hex; nonce: Hex;
}
export interface ActivationState {
  block: Block; nameLive: boolean; containerLive: boolean; paidUntil: string; containerPaidUntil: string;
}
export interface ActivationPreview {
  id: string; expiresAt: number; transaction: ActivationTransaction; serviceFeeWei: string;
  maximumGasCostWei: string; maximumTotalWei: string; state: ActivationState;
}
export interface ActivationAttempt {
  id: string; createdAt: number; consent: typeof ACTIVATION_CONSENT; quote: ActivationPreview;
  status: 'reserved' | 'confirmed' | 'reverted' | 'cancelled-by-user'; hash?: Hex;
  block?: Block; gasUsed?: string; effectiveGasPriceWei?: string; state?: ActivationState;
  cancellationAcknowledgedAt?: number;
}
export interface ActivationJournal { schemaVersion: 1; contextId: string; attempts: ActivationAttempt[] }

// This coordinator produces unsigned transactions only. Its journal is separate from uploads.
export class PublicationActivation {
  readonly contextId: string;
  readonly name: string;
  private preview: ActivationPreview | null = null;
  private busy = false;
  private fault = false;
  private observed: ActivationState | null = null;
  constructor(private rpc: StrictRpc, private upload: PublicationWorkbench, private journal: ActivationJournal,
    private store: { save(journal: ActivationJournal): Promise<void> }, private now = Date.now) {
    this.name = `${BigInt(upload.profile.circuitId)}.2.${BigInt(upload.profile.processorIndex)}.tape`;
    this.contextId = PublicationActivation.contextId(upload);
    if (journal.schemaVersion !== 1 || journal.contextId !== this.contextId ||
        !Array.isArray(journal.attempts) || journal.attempts.length > 100)
      throw new Error('Activation journal does not match release');
    const ids = new Set(), hashes = new Set();
    for (const [i, a] of journal.attempts.entries()) {
      const q = a?.quote, tx = q?.transaction;
      if (!a || typeof a.id !== 'string' || ids.has(a.id) || !Number.isSafeInteger(a.createdAt) ||
          a.consent !== ACTIVATION_CONSENT || !q || !Number.isSafeInteger(q.expiresAt) ||
          a.createdAt >= q.expiresAt || !tx || tx.from !== upload.profile.publisher || tx.to !== BINDING ||
          tx.data !== this.data() || tx.chainId !== '0xc4' || quantity(tx.gas) < 21_000n ||
          quantity(tx.gas) > GAS_CAP || quantity(tx.gasPrice) > PRICE_CAP || quantity(tx.nonce) >= 1n << 64n ||
          quantity(tx.value).toString() !== q.serviceFeeWei ||
          (quantity(tx.gas) * quantity(tx.gasPrice)).toString() !== q.maximumGasCostWei ||
          (quantity(tx.value) + quantity(tx.gas) * quantity(tx.gasPrice)).toString() !== q.maximumTotalWei ||
          !['reserved', 'confirmed', 'reverted', 'cancelled-by-user'].includes(a.status) ||
          (a.status === 'reserved' && i !== journal.attempts.length - 1))
        throw new Error('Invalid activation journal entry');
      ids.add(a.id);
      this.validateState(q.state);
      if (a.hash) { hash(a.hash); if (hashes.has(a.hash.toLowerCase())) throw new Error('Repeated activation hash'); hashes.add(a.hash.toLowerCase()); }
      if (a.status === 'cancelled-by-user') {
        if (a.hash || a.block || !Number.isSafeInteger(a.cancellationAcknowledgedAt)) throw new Error('Invalid activation cancellation');
      } else if (a.status !== 'reserved') {
        if (!a.hash || !a.block || !/^[1-9][0-9]*$/.test(a.gasUsed ?? '') ||
            !/^[0-9]+$/.test(a.effectiveGasPriceWei ?? '') ||
            BigInt(a.gasUsed!) < 21_000n || BigInt(a.gasUsed!) > quantity(tx.gas) ||
            BigInt(a.effectiveGasPriceWei!) > quantity(tx.gasPrice))
          throw new Error('Invalid activation receipt evidence');
        this.validateBlock(a.block);
        if (a.status === 'confirmed') {
          if (!a.state) throw new Error('Missing activation state evidence');
          this.validateState(a.state);
          if (!this.provesActivation(a, a.block, a.state)) throw new Error('Invalid activation expiry evidence');
        }
      }
    }
  }
  static contextId(upload: PublicationWorkbench) {
    return digest(Buffer.from(JSON.stringify({ upload: upload.contextId, scope: 'bind-30-days-v1', binding: BINDING })));
  }
  private data() { return encodeFunctionData({ abi: activationAbi, functionName: 'bind',
    args: [this.name, this.upload.profile.container, 1n] }); }
  private validateBlock(b: Block) { hash(b?.hash); quantity(b?.number); quantity(b?.timestamp); }
  private validateState(s: ActivationState) {
    if (!s || typeof s.nameLive !== 'boolean' || typeof s.containerLive !== 'boolean' ||
        !/^[0-9]+$/.test(s.paidUntil) || !/^[0-9]+$/.test(s.containerPaidUntil) ||
        BigInt(s.paidUntil) >= 1n << 40n || BigInt(s.containerPaidUntil) >= 1n << 40n)
      throw new Error('Invalid activation state');
    this.validateBlock(s.block);
  }
  private pending() { return this.journal.attempts.find(a => a.status === 'reserved'); }
  private async exclusive<T>(fn: () => Promise<T>) {
    if (this.busy || this.fault) throw new Error(this.fault ? 'Activation journal write failed; restart and inspect' : 'Activation check already running');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }
  private async persist() {
    try { await this.store.save(structuredClone(this.journal)); } catch (error) { this.fault = true; throw error; }
  }
  context() {
    return { contextId: this.contextId, name: this.name, container: this.upload.profile.container,
      publisher: this.upload.profile.publisher, binding: BINDING, chainId: 196, months: 1,
      gasCap: GAS_CAP.toString(), gasPriceCapWei: PRICE_CAP.toString(), consent: ACTIVATION_CONSENT,
      unresolved: this.pending()?.id ?? null, attempts: structuredClone(this.journal.attempts),
      observed: this.observed, scope: 'Separate 30-day activation consent; EVM gas excludes chain-specific fees. Observed code pins are not an independent security review.' };
  }
  private async call<T>(name: string, args: readonly unknown[], block: Block) {
    const data = await this.rpc.request<Hex>('eth_call', [{ to: BINDING,
      data: encodeFunctionData({ abi: activationAbi as Abi, functionName: name, args }) }, block.number]);
    return decodeFunctionResult({ abi: activationAbi as Abi, functionName: name, data }) as T;
  }
  private async state(block: Block): Promise<ActivationState> {
    const c = this.upload.profile.container;
    const [nameLive, containerLive, paid, containerPaid] = await Promise.all([
      this.call<boolean>('isLive', [this.name, c], block), this.call<boolean>('isContainerLive', [c], block),
      this.call<bigint>('paidUntil', [keccak256(toHex(this.name)), c], block),
      this.call<bigint>('containerPaidUntil', [c], block),
    ]);
    const state = { block, nameLive, containerLive, paidUntil: paid.toString(), containerPaidUntil: containerPaid.toString() };
    this.validateState(state);
    await this.rpc.assertBlock(block);
    return state;
  }
  refresh() {
    return this.exclusive(async () => {
      await this.rpc.checkChain(196);
      for (const a of this.journal.attempts) if (a.block) await this.rpc.assertBlock(a.block);
      this.observed = await this.state(await this.rpc.pin());
      return this.context();
    });
  }
  private async prepare(): Promise<ActivationPreview | { live: true; state: ActivationState }> {
    if (this.pending()) throw new Error('Previous activation request unresolved; do not resend');
    if (this.journal.attempts.length >= 100) throw new Error('Activation attempt limit reached');
    await this.upload.verifyCompleted();
    // Checks owner, container derivation and contract pins; no registry transaction is submitted.
    await inspectPublication(this.rpc, this.upload.profile, [fallbackTransaction(this.upload.profile.container)]);
    for (const a of this.journal.attempts) if (a.block) await this.rpc.assertBlock(a.block);
    const block = await this.rpc.pin(), state = await this.state(block);
    this.observed = state;
    if (state.nameLive && state.containerLive) return { live: true, state };
    const [fee, price, latest, pending] = await Promise.all([
      this.call<bigint>('monthlyFee', [], block), this.rpc.gasPrice(),
      this.rpc.request<Hex>('eth_getTransactionCount', [this.upload.profile.publisher, 'latest']),
      this.rpc.request<Hex>('eth_getTransactionCount', [this.upload.profile.publisher, 'pending']),
    ]);
    if (quantity(latest) !== quantity(pending)) throw new Error('Publisher has pending transactions');
    if (price > PRICE_CAP) throw new Error('Activation gas price exceeds cap');
    const base = { from: this.upload.profile.publisher, to: BINDING, data: this.data(), value: hex(fee) };
    await this.rpc.request('eth_call', [base, block.number]);
    const estimate = await this.rpc.estimate({ ...base, nonce: latest, gasPrice: hex(price) });
    const gas = (estimate * 120n + 99n) / 100n;
    if (gas < 21_000n || gas > GAS_CAP) throw new Error('Activation gas estimate exceeds cap');
    await this.rpc.assertBlock(block);
    return { id: randomUUID(), expiresAt: this.now() + 120_000, serviceFeeWei: fee.toString(),
      maximumGasCostWei: (gas * price).toString(), maximumTotalWei: (fee + gas * price).toString(), state,
      transaction: { ...base, chainId: '0xc4', nonce: latest, gas: hex(gas), gasPrice: hex(price) } };
  }
  previewActivation() {
    return this.exclusive(async () => {
      this.preview = null;
      const q = await this.prepare();
      if (!('live' in q)) this.preview = q;
      return q;
    });
  }
  reserve(previewId: unknown, consent: unknown, maximumTotalWei: unknown) {
    return this.exclusive(async () => {
      const q = this.preview; this.preview = null;
      if (!q || previewId !== q.id || q.expiresAt <= this.now()) throw new Error('Activation quote expired; refresh');
      if (consent !== ACTIVATION_CONSENT || maximumTotalWei !== q.maximumTotalWei) throw new Error('Explicit activation fee consent required');
      const fresh = await this.prepare();
      if ('live' in fresh || fresh.transaction.data !== q.transaction.data || fresh.transaction.nonce !== q.transaction.nonce ||
          fresh.serviceFeeWei !== q.serviceFeeWei || quantity(fresh.transaction.gas) > quantity(q.transaction.gas) ||
          quantity(fresh.transaction.gasPrice) > quantity(q.transaction.gasPrice) ||
          fresh.state.paidUntil !== q.state.paidUntil || q.expiresAt <= this.now())
        throw new Error('Activation state or quote changed; refresh and confirm again');
      const a: ActivationAttempt = { id: randomUUID(), createdAt: this.now(), consent: ACTIVATION_CONSENT,
        quote: q, status: 'reserved' };
      this.journal.attempts.push(a); await this.persist();
      return structuredClone(a);
    });
  }
  attachHash(attemptId: unknown, txHash: unknown) {
    return this.exclusive(async () => {
      hash(txHash);
      const a = this.pending();
      if (!a || a.id !== attemptId || a.hash && a.hash.toLowerCase() !== txHash.toLowerCase())
        throw new Error('Activation hash does not match unresolved request');
      a.hash = txHash.toLowerCase() as Hex;
      await this.persist(); return this.context();
    });
  }
  cancel(attemptId: unknown, acknowledgement: unknown) {
    return this.exclusive(async () => {
      const a = this.pending();
      if (!a || a.id !== attemptId || a.hash || acknowledgement !== 'WALLET_REQUEST_CANCELLED_NO_PENDING_SIGNATURE')
        throw new Error('Explicit wallet cancellation required; hashed requests must be reconciled');
      await this.rpc.checkChain(196);
      const [latest, pending] = await Promise.all(['latest', 'pending'].map(tag =>
        this.rpc.request<Hex>('eth_getTransactionCount', [this.upload.profile.publisher, tag])));
      if (quantity(latest) !== quantity(a.quote.transaction.nonce) || quantity(pending) !== quantity(latest))
        throw new Error('Activation nonce changed or transaction pending; inspect wallet');
      a.status = 'cancelled-by-user'; a.cancellationAcknowledgedAt = this.now();
      await this.persist(); return this.context();
    });
  }
  private provesActivation(a: ActivationAttempt, block: Block, state: ActivationState) {
    const start = BigInt(a.quote.state.paidUntil) > BigInt(block.timestamp) ? BigInt(a.quote.state.paidUntil) : BigInt(block.timestamp);
    return BigInt(state.block.number) >= BigInt(block.number) &&
      state.nameLive && state.containerLive && BigInt(state.paidUntil) >= start + DURATION &&
      BigInt(state.containerPaidUntil) >= BigInt(state.paidUntil) &&
      BigInt(state.paidUntil) > BigInt(state.block.timestamp);
  }
  reconcile() {
    return this.exclusive(async () => {
      const a = this.pending();
      if (!a?.hash) throw new Error('Supply activation transaction hash first');
      await this.rpc.checkChain(196);
      const [r, actual] = await Promise.all([
        this.rpc.request<Record<string, unknown> | null>('eth_getTransactionReceipt', [a.hash],
          fields(['status', 'transactionHash', 'blockNumber', 'blockHash', 'gasUsed', 'effectiveGasPrice'])),
        this.rpc.request<Record<string, unknown> | null>('eth_getTransactionByHash', [a.hash],
          fields(['hash', 'from', 'to', 'input', 'value', 'nonce', 'chainId', 'gas', 'gasPrice', 'type',
            'maxFeePerGas', 'maxPriorityFeePerGas', 'blockNumber', 'blockHash'])),
      ]);
      if (!r || !actual) throw new Error('Activation not confirmed by both RPC sources; keep waiting');
      const tx = a.quote.transaction, used = quantity(r.gasUsed), price = quantity(r.effectiveGasPrice);
      // Accept a wallet's larger unused gas envelope only when settled usage fits the exact consent.
      if (!['0x0', '0x1'].includes(String(r.status)) || r.transactionHash !== a.hash || actual.hash !== a.hash ||
          ![undefined, '0x0', '0x1', '0x2'].includes(actual.type as string | undefined) ||
          typeof actual.from !== 'string' || getAddress(actual.from) !== tx.from ||
          typeof actual.to !== 'string' || getAddress(actual.to) !== BINDING ||
          actual.input !== tx.data || quantity(actual.value) !== quantity(tx.value) ||
          quantity(actual.nonce) !== quantity(tx.nonce) || quantity(actual.chainId) !== 196n ||
          actual.blockNumber !== r.blockNumber || actual.blockHash !== r.blockHash ||
          used < 21_000n || used > quantity(tx.gas) || used > quantity(actual.gas) ||
          price !== quantity(actual.gasPrice) || price > quantity(tx.gasPrice) ||
          (actual.type === '0x2' && (price > quantity(actual.maxFeePerGas) ||
            quantity(actual.maxPriorityFeePerGas) > quantity(actual.maxFeePerGas))))
        throw new Error('Activation transaction or settled fee differs from consent');
      const block = await this.rpc.block(r.blockNumber as Hex), stable = await this.rpc.pin();
      if (block.hash !== r.blockHash || BigInt(stable.number) < BigInt(block.number)) throw new Error('Activation block not yet stable');
      const state = await this.state(stable);
      if (r.status === '0x1' && !this.provesActivation(a, block, state))
        throw new Error('Activation name, container or 30-day expiry not verified');
      await this.rpc.assertBlock(block);
      a.status = r.status === '0x1' ? 'confirmed' : 'reverted';
      a.block = block; a.gasUsed = used.toString(); a.effectiveGasPriceWei = price.toString();
      if (a.status === 'confirmed') a.state = state;
      this.observed = state;
      await this.persist(); return this.context();
    });
  }
}
