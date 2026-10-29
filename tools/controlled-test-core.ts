import { randomUUID } from 'node:crypto';
import { decodeFunctionResult, getAddress, type Hex } from 'viem';
import { MANAGER, managerAbi } from '../src/config';
import { V3Adapter } from '../src/core/adapter';
import { StrictRpc } from '../src/core/rpc';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';
import { digest } from './publish-core';
import { checkTestAssets, controlledTestData, TEST_POLICY, validateTestData } from './controlled-test-policy';

type Transaction = {
  from: string; to: string; chainId: '0xc4'; value: '0x0'; data: Hex;
  nonce: Hex; gas: Hex; gasPrice: Hex;
};
export interface TestQuote {
  id: string; expiresAt: number; transaction: Transaction; maximumGasCostWei: string;
  estimatedAmounts: string[]; minimums: string[]; deadline: string;
}
interface TestAttempt {
  id: string; status: 'reserved' | 'confirmed' | 'reverted' | 'cancelled';
  quote: TestQuote; consent: string; hash?: Hex; outcome?: Awaited<ReturnType<typeof inspectRecoveryOutcome>>;
  gasUsed?: string; effectiveGasPriceWei?: string;
}
export interface TestJournal { schemaVersion: 1; contextId: string; attempts: TestAttempt[] }
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value))
    throw new Error('Invalid test RPC quantity');
  return BigInt(value);
}
function hash(value: unknown): asserts value is Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid transaction hash');
}
const hex = (n: bigint): Hex => `0x${n.toString(16)}`;
const fields = (keys: string[]) => (v: Record<string, unknown> | null) =>
  v === null ? null : Object.fromEntries(keys.map(key => [key, v[key] ?? null]));
const receiptKeys = ['status', 'transactionHash', 'from', 'to', 'blockHash', 'blockNumber', 'gasUsed', 'effectiveGasPrice'];
const transactionKeys = ['hash', 'from', 'to', 'input', 'value', 'nonce', 'chainId', 'gas', 'gasPrice', 'blockNumber', 'blockHash'];

// An explicit, separate mainnet test tool; never changes the production allowlist or release gate.
export class ControlledTest {
  static contextId = digest(Buffer.from(JSON.stringify({ policy: TEST_POLICY, version: 1 })));
  private quote: TestQuote | null = null;
  private busy = false;
  private fault = false;
  private freshlyVerified = false;
  constructor(private rpc: StrictRpc, private journal: TestJournal,
    private store: { save(journal: TestJournal): Promise<void> }, private now = Date.now) {
    if (journal.schemaVersion !== 1 || journal.contextId !== ControlledTest.contextId ||
        !Array.isArray(journal.attempts) || journal.attempts.length > 20)
      throw new Error('Invalid controlled-test journal');
    const ids = new Set(), hashes = new Set();
    let completed = false;
    for (const [i, a] of journal.attempts.entries()) {
      if (!a || typeof a.id !== 'string' || ids.has(a.id) || completed ||
          !['reserved', 'confirmed', 'reverted', 'cancelled'].includes(a.status) ||
          (a.status === 'reserved' && i !== journal.attempts.length - 1) || a.consent !== TEST_POLICY.consent)
        throw new Error('Invalid controlled-test attempt');
      ids.add(a.id);
      this.validateQuote(a.quote);
      if (a.hash) { hash(a.hash); if (hashes.has(a.hash)) throw new Error('Duplicate test hash'); hashes.add(a.hash); }
      if (a.status === 'cancelled' && a.hash) throw new Error('Cannot cancel a hashed test');
      if (a.status === 'confirmed' || a.status === 'reverted') {
        if (!a.hash || !/^[1-9][0-9]*$/.test(a.gasUsed ?? '') ||
            !/^(0|[1-9][0-9]*)$/.test(a.effectiveGasPriceWei ?? '') ||
            BigInt(a.gasUsed!) > quantity(a.quote.transaction.gas) ||
            BigInt(a.effectiveGasPriceWei!) > quantity(a.quote.transaction.gasPrice))
          throw new Error('Invalid saved test fee evidence');
        if (a.status === 'confirmed') {
          const o = a.outcome;
          if (!o || o.state !== 'block-state-matched' || !('receipt' in o) ||
              o.hash !== a.hash || !o.receipt.finalized ||
              o.liquidity.before !== TEST_POLICY.baselineLiquidity ||
              o.liquidity.removed !== TEST_POLICY.removeLiquidity)
            throw new Error('Missing saved test outcome evidence');
        }
        completed = a.status === 'confirmed';
      }
    }
  }
  private validateQuote(q: TestQuote) {
    const tx = q?.transaction, p = TEST_POLICY;
    if (!tx || tx.from !== p.account || tx.to !== MANAGER || tx.chainId !== '0xc4' || tx.value !== '0x0' ||
        !Number.isSafeInteger(q.expiresAt) || typeof q.id !== 'string' ||
        quantity(tx.nonce) >= 1n << 64n || quantity(tx.gas) < 21000n || quantity(tx.gas) > BigInt(p.gasCap) ||
        quantity(tx.gasPrice) > BigInt(p.gasPriceCapWei) ||
        (quantity(tx.gas) * quantity(tx.gasPrice)).toString() !== q.maximumGasCostWei)
      throw new Error('Invalid saved test quote');
    const d = validateTestData(tx.data);
    if (d.deadline.toString() !== q.deadline || !Array.isArray(q.minimums) ||
        JSON.stringify(q.minimums) !== JSON.stringify([d.amount0Min.toString(), d.amount1Min.toString()]) ||
        !Array.isArray(q.estimatedAmounts) || q.estimatedAmounts.length !== 2 ||
        q.estimatedAmounts.some((n, i) => !/^[1-9][0-9]*$/.test(n) ||
          BigInt(n) < BigInt(q.minimums[i]) || BigInt(n) > BigInt(p.maximumCollectionPerToken)))
      throw new Error('Invalid saved test amount or deadline');
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy || this.fault) throw new Error(this.fault ? 'Journal write failed; restart and inspect' : 'Test check already running');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  private async persist() {
    try { await this.store.save(structuredClone(this.journal)); }
    catch (error) { this.fault = true; throw error; }
  }
  private pending() { return this.journal.attempts.find(a => a.status === 'reserved'); }
  context() {
    return { contextId: ControlledTest.contextId, policy: TEST_POLICY, manager: MANAGER,
      productionSigningApproved: false, independentReview: 'NOT_COMPLETED', assetApproval: 'NOT_APPROVED',
      unresolved: this.pending()?.id ?? null, complete: this.journal.attempts.some(a => a.status === 'confirmed'),
      freshlyVerified: this.freshlyVerified,
      attempts: structuredClone(this.journal.attempts) };
  }
  private async snapshot() {
    const adapter = new V3Adapter(this.rpc);
    const snapshot = await adapter.snapshot(BigInt(TEST_POLICY.tokenId));
    await checkTestAssets(adapter, snapshot);
    return snapshot;
  }
  private async simulate(data: Hex, block: Hex) {
    const result = await this.rpc.request<Hex>('eth_call',
      [{ from: TEST_POLICY.account, to: MANAGER, data, value: '0x0' }, block]);
    const calls = decodeFunctionResult({ abi: managerAbi, functionName: 'multicall', data: result });
    if (calls.length !== 2) throw new Error('Invalid test simulation');
    const amounts = decodeFunctionResult({ abi: managerAbi, functionName: 'collect', data: calls[1] });
    const d = validateTestData(data);
    if (amounts[0] < d.amount0Min || amounts[1] < d.amount1Min ||
        amounts.some(n => n > BigInt(TEST_POLICY.maximumCollectionPerToken)))
      throw new Error('Test simulation is outside the fixed output bounds');
    return amounts.map(String);
  }
  private async nonce() {
    const [latest, pending] = await Promise.all(['latest', 'pending'].map(tag =>
      this.rpc.request<Hex>('eth_getTransactionCount', [TEST_POLICY.account, tag])));
    if (quantity(latest) !== quantity(pending)) throw new Error('Wallet has a pending transaction');
    return latest;
  }
  preview() {
    return this.exclusive(async () => {
      this.quote = null;
      if (this.pending() || this.context().complete || this.journal.attempts.length >= 20)
        throw new Error('Previous test unresolved or completed; do not repeat the exit');
      const s = await this.snapshot(), intent = controlledTestData(s);
      const [nonce, price, amounts] = await Promise.all([
        this.nonce(), this.rpc.gasPrice(), this.simulate(intent.data, s.block.number),
      ]);
      if (price > BigInt(TEST_POLICY.gasPriceCapWei))
        throw new Error(`Test gas price ${price} wei exceeds the fixed cap`);
      const base = { from: TEST_POLICY.account, to: MANAGER, value: '0x0' as const,
        data: intent.data, nonce, gasPrice: hex(price) };
      const gas = ((await this.rpc.estimate(base)) * 120n + 99n) / 100n;
      if (gas < 21000n || gas > BigInt(TEST_POLICY.gasCap))
        throw new Error(`Test gas estimate ${gas} exceeds the fixed cap`);
      await this.rpc.assertBlock(s.block);
      const q: TestQuote = { ...intent, id: randomUUID(), expiresAt: this.now() + 90_000,
        estimatedAmounts: amounts, maximumGasCostWei: (gas * price).toString(),
        transaction: { ...base, chainId: '0xc4', gas: hex(gas) } };
      this.validateQuote(q); this.quote = q; return structuredClone(q);
    });
  }
  reserve(previewId: unknown, consent: unknown, maximumGasCostWei: unknown) {
    return this.exclusive(async () => {
      const q = this.quote; this.quote = null;
      if (!q || previewId !== q.id || q.expiresAt <= this.now() || this.pending() || this.context().complete)
        throw new Error('Test preview expired or unresolved; prepare again');
      if (consent !== TEST_POLICY.consent || maximumGasCostWei !== q.maximumGasCostWei)
        throw new Error('Explicit small-test amount, unreviewed-risk and fee consent required');
      const s = await this.snapshot(), tx = q.transaction;
      const [nonce, price] = await Promise.all([this.nonce(), this.rpc.gasPrice()]);
      await this.simulate(tx.data, s.block.number);
      const gas = ((await this.rpc.estimate(tx)) * 120n + 99n) / 100n;
      if (nonce !== tx.nonce || price > quantity(tx.gasPrice) || gas > quantity(tx.gas) ||
          BigInt(q.deadline) <= BigInt(s.block.timestamp) + 60n || q.expiresAt <= this.now())
        throw new Error('Test state, nonce or fee changed; prepare again');
      await this.rpc.assertBlock(s.block);
      const a: TestAttempt = { id: randomUUID(), status: 'reserved', quote: q, consent: TEST_POLICY.consent };
      this.journal.attempts.push(a); await this.persist(); return structuredClone(a);
    });
  }
  attachHash(id: unknown, value: unknown) {
    return this.exclusive(async () => {
      hash(value);
      const a = this.pending();
      if (!a || a.id !== id || a.hash && a.hash.toLowerCase() !== value.toLowerCase())
        throw new Error('Hash differs from unresolved test request');
      a.hash = value.toLowerCase() as Hex; await this.persist(); return this.context();
    });
  }
  cancel(id: unknown, acknowledgement: unknown) {
    return this.exclusive(async () => {
      const a = this.pending();
      if (!a || a.id !== id || a.hash || acknowledgement !== 'WALLET_CANCELLED_NO_PENDING_SIGNATURE')
        throw new Error('Explicit wallet cancellation required; hashed requests must be checked');
      await this.rpc.checkChain(196);
      if (quantity(await this.nonce()) !== quantity(a.quote.transaction.nonce))
        throw new Error('Nonce changed; inspect wallet before recovery');
      a.status = 'cancelled'; await this.persist(); return this.context();
    });
  }
  reconcile() {
    return this.exclusive(async () => {
      this.freshlyVerified = false;
      const a = this.pending() ?? this.journal.attempts.find(a => a.status === 'confirmed');
      if (!a?.hash) throw new Error('Supply the wallet transaction hash first');
      await this.rpc.checkChain(196);
      const [receipt, actual] = await Promise.all([
        this.rpc.request<Record<string, any> | null>('eth_getTransactionReceipt', [a.hash],
          fields(receiptKeys)),
        this.rpc.request<Record<string, any> | null>('eth_getTransactionByHash', [a.hash],
          fields(transactionKeys)),
      ]);
      if (!receipt || !actual || actual.blockNumber == null) throw new Error('Transaction pending; check again without resending');
      const tx = a.quote.transaction, used = quantity(receipt.gasUsed), price = quantity(receipt.effectiveGasPrice);
      if (receipt.transactionHash !== a.hash || actual.hash !== a.hash || actual.input !== tx.data ||
          getAddress(actual.from) !== tx.from || getAddress(actual.to) !== tx.to ||
          getAddress(receipt.from) !== tx.from || getAddress(receipt.to) !== tx.to ||
          quantity(actual.value) !== 0n || quantity(actual.chainId) !== 196n ||
          quantity(actual.nonce) !== quantity(tx.nonce) || actual.blockHash !== receipt.blockHash ||
          actual.blockNumber !== receipt.blockNumber || !['0x0', '0x1'].includes(receipt.status) ||
          used < 21000n || used > quantity(tx.gas) || used > quantity(actual.gas) ||
          price !== quantity(actual.gasPrice) || price > quantity(tx.gasPrice))
        throw new Error('Actual test transaction or settled fee differs from the consent');
      const block = await this.rpc.block(receipt.blockNumber), final = await this.rpc.block('finalized');
      if (block.hash !== receipt.blockHash || BigInt(final.number) < BigInt(block.number))
        throw new Error('Receipt not finalized; check again without resending');
      let outcome: TestAttempt['outcome'];
      if (receipt.status === '0x1') {
        outcome = await inspectRecoveryOutcome(this.rpc, a.hash, BigInt(TEST_POLICY.tokenId), TEST_POLICY.account);
        if (outcome.state !== 'block-state-matched' || !('receipt' in outcome) || !outcome.receipt.finalized ||
            outcome.receipt.blockHash !== block.hash ||
            outcome.liquidity.before !== TEST_POLICY.baselineLiquidity ||
            outcome.liquidity.removed !== TEST_POLICY.removeLiquidity ||
            outcome.balances.some(b => BigInt(b.delta) > BigInt(TEST_POLICY.maximumCollectionPerToken)))
          throw new Error('Receipt, token arrival or remaining liquidity not matched; retain the request');
      }
      const [lastReceipt, lastTransaction] = await Promise.all([
        this.rpc.request<Record<string, any> | null>('eth_getTransactionReceipt', [a.hash],
          fields(receiptKeys)),
        this.rpc.request<Record<string, any> | null>('eth_getTransactionByHash', [a.hash],
          fields(transactionKeys)),
      ]);
      const same = (left: Record<string, any> | null, right: Record<string, any>, keys: string[]) =>
        !!left && keys.every(key => left[key] === right[key]);
      if (!same(lastReceipt, receipt, receiptKeys) || !same(lastTransaction, actual, transactionKeys))
        throw new Error('Test transaction or receipt changed during recovery verification');
      await this.rpc.assertBlock(block); await this.rpc.assertBlock(final);
      a.status = receipt.status === '0x1' ? 'confirmed' : 'reverted';
      if (outcome) a.outcome = outcome;
      else delete a.outcome;
      a.gasUsed = used.toString(); a.effectiveGasPriceWei = price.toString();
      await this.persist(); this.freshlyVerified = a.status === 'confirmed'; return this.context();
    });
  }
}
