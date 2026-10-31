import { randomUUID } from 'node:crypto';
import { decodeEventLog, decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi, toHex,
  zeroAddress, type Hex } from 'viem';
import { SparkVaultAdapter, vaultPlan } from '../src/core/vault-adapter';
import { SPARK_USDC } from '../src/core/vault-config';
import { inspectVaultRecovery, vaultRecoveryTask } from '../src/core/vault-recovery';
import { assertTransactionIdentity, minedTransaction, receiptEvidence } from '../src/core/chain-evidence';
import { StrictRpc, type Block } from '../src/core/rpc';
import { digest } from './publish-core';
import { inspectForkOwner } from './fork-owner';
import { decodeStorageAddress } from './proxy-identity-core';

export const VAULT_TEST = Object.freeze({
  account: getAddress('0x101fd328a0b2fd9e853909651dab1c0b55947c03'),
  asset: SPARK_USDC.asset, vault: SPARK_USDC.vault, chainId: 196,
  depositAssets: '1000000', gasCap: '1000000', gasPriceCapWei: '30000000',
  totalGasCostCapWei: '360000000000000',
  consent: 'ONE_USDC_SPARK_MAINNET_TEST_UNREVIEWED_SELF_RECEIVER',
});
export const walletVaultAbi = parseAbi([
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function previewDeposit(uint256) view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function deposit(uint256,address) returns (uint256)',
  'function redeem(uint256,address,address) returns (uint256)',
  'function paused() view returns (bool)',
  'function isBlacklisted(address) view returns (bool)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)',
]);
type Stage = 'approve' | 'deposit' | 'partial' | 'full';
export interface VaultTestQuote {
  id: string; stage: Stage; expiresAt: number; amount: string; output: string; minimumOutput: string;
  beforeShares: string; maximumGasCostWei: string;
  transaction: { from: string; to: string; chainId: '0xc4'; value: '0x0'; data: Hex;
    nonce: Hex; gas: Hex; gasPrice: Hex };
}
export interface VaultTestAttempt {
  id: string; status: 'reserved' | 'confirmed' | 'reverted' | 'cancelled';
  quote: VaultTestQuote; consent: string; hash?: Hex;
  outcome?: { assets: string; shares: string; remainingShares: string; block: Block; finalized: true;
    recovery?: ReturnType<typeof vaultRecoveryTask>; gasUsed: string; effectiveGasPrice: string };
}
export interface VaultTestJournal {
  schemaVersion: 1; contextId: string;
  baseline: null | { approvalRequired: boolean; initialAllowance: string; block: Block };
  attempts: VaultTestAttempt[];
}
const p = VAULT_TEST;
const hex = (value: bigint): Hex => `0x${value.toString(16)}`;
function uint(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw Error('Invalid stored amount');
  return BigInt(value);
}
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value))
    throw Error('Invalid RPC quantity');
  return BigInt(value);
}
function hash(value: unknown): asserts value is Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value) || /^0x0{64}$/i.test(value))
    throw Error('Invalid transaction hash');
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A fixed one-USDC extension test. No key, RPC write, public release gate or arbitrary transaction route. */
export class VaultWalletTest {
  static contextId = digest(Buffer.from(JSON.stringify({ policy: p, deployment: SPARK_USDC, version: 1 })));
  private quote: VaultTestQuote | null = null;
  private busy = false;
  private fault = false;
  private fresh = false;
  private verification: { phase: 'receipt' | 'waiting-finality' | 'balances' | 'complete' | 'failed';
    stage?: Stage; receiptBlock?: string; finalizedBlock?: string; blocksRemaining?: string } | null = null;
  constructor(private rpc: StrictRpc, private journal: VaultTestJournal,
    private store: { save(journal: VaultTestJournal): Promise<void> }, private now = Date.now) {
    if (journal.schemaVersion !== 1 || journal.contextId !== VaultWalletTest.contextId ||
        !Array.isArray(journal.attempts) || journal.attempts.length > 12)
      throw Error('Invalid vault wallet journal');
    if (journal.baseline && (typeof journal.baseline.approvalRequired !== 'boolean' ||
        journal.baseline.approvalRequired !== (uint(journal.baseline.initialAllowance) < 1000000n)))
      throw Error('Invalid baseline');
    const ids = new Set(), hashes = new Set(), confirmed = new Set();
    for (const [index, attempt] of journal.attempts.entries()) {
      if (!attempt || ids.has(attempt.id) || typeof attempt.id !== 'string' || !journal.baseline ||
          !['reserved', 'confirmed', 'reverted', 'cancelled'].includes(attempt.status) ||
          attempt.consent !== p.consent || attempt.status === 'reserved' && index !== journal.attempts.length - 1)
        throw Error('Invalid vault test attempt');
      ids.add(attempt.id);
      this.validateQuote(attempt.quote);
      if (attempt.hash) {
        hash(attempt.hash);
        if (hashes.has(attempt.hash)) throw Error('Duplicate transaction hash');
        hashes.add(attempt.hash);
      }
      const sequence: Stage[] = journal.baseline.approvalRequired
        ? ['approve', 'deposit', 'partial', 'full'] : ['deposit', 'partial', 'full'];
      if (attempt.quote.stage !== sequence[confirmed.size]) throw Error('Invalid test sequence');
      if (attempt.status === 'confirmed') {
        if (!attempt.hash || !attempt.outcome?.finalized) throw Error('Missing confirmation evidence');
        confirmed.add(attempt.quote.stage);
      }
      if (attempt.status === 'reverted' && !attempt.hash ||
          attempt.status === 'cancelled' && attempt.hash) throw Error('Invalid attempt hash');
    }
    this.spent();
  }
  private validateQuote(q: VaultTestQuote) {
    const tx = q?.transaction;
    if (!tx || tx.from !== p.account || tx.chainId !== '0xc4' || tx.value !== '0x0' ||
        typeof q.id !== 'string' || !Number.isSafeInteger(q.expiresAt) ||
        !['approve', 'deposit', 'partial', 'full'].includes(q.stage) ||
        quantity(tx.nonce) >= 1n << 64n || quantity(tx.gas) < 21000n ||
        quantity(tx.gas) > BigInt(p.gasCap) || quantity(tx.gasPrice) > BigInt(p.gasPriceCapWei) ||
        quantity(tx.gas) * quantity(tx.gasPrice) !== uint(q.maximumGasCostWei))
      throw Error('Invalid vault test quote');
    const amount = uint(q.amount), output = uint(q.output), minimum = uint(q.minimumOutput);
    const before = uint(q.beforeShares);
    if (!amount || output <= 0n || minimum !== output * 995n / 1000n || minimum <= 0n)
      throw Error('Invalid output bounds');
    const decoded = decodeFunctionData({ abi: walletVaultAbi, data: tx.data });
    const approve = q.stage === 'approve', deposit = q.stage === 'deposit';
    const canonical = approve
      ? encodeFunctionData({ abi: walletVaultAbi, functionName: 'approve', args: [p.vault, 1000000n] })
      : deposit ? encodeFunctionData({ abi: walletVaultAbi, functionName: 'deposit', args: [1000000n, p.account] })
        : encodeFunctionData({ abi: walletVaultAbi, functionName: 'redeem', args: [amount, p.account, p.account] });
    if (tx.to !== (approve ? p.asset : p.vault) || canonical !== tx.data ||
        decoded.functionName !== (approve ? 'approve' : deposit ? 'deposit' : 'redeem') ||
        ((approve || deposit) && (amount !== 1000000n || before !== 0n)) ||
        (!approve && !deposit && (amount > before || before > 2000000n ||
          (q.stage === 'partial' ? amount !== before / 2n : amount !== before))) ||
        (!approve && (deposit ? output > 2000000n : output > 1100000n)))
      throw Error('Vault test transaction outside fixed scope');
  }
  private async exclusive<T>(action: () => Promise<T>) {
    if (this.busy || this.fault) throw Error(this.fault ? 'Journal write failed; restart and inspect' : 'Check already running');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  private async persist() {
    try { await this.store.save(structuredClone(this.journal)); }
    catch (error) { this.fault = true; throw error; }
  }
  private pending() { return this.journal.attempts.find(a => a.status === 'reserved'); }
  private successful() { return this.journal.attempts.filter(a => a.status === 'confirmed'); }
  private stages(): Stage[] {
    return this.journal.baseline?.approvalRequired
      ? ['approve', 'deposit', 'partial', 'full'] : ['deposit', 'partial', 'full'];
  }
  private spent() {
    const total = this.journal.attempts.reduce((sum, a) => sum + uint(a.quote.maximumGasCostWei), 0n);
    if (total > BigInt(p.totalGasCostCapWei)) throw Error('Total test gas budget exceeded');
    return total;
  }
  context() {
    const successful = this.successful();
    return {
      contextId: VaultWalletTest.contextId, policy: p, deployment: SPARK_USDC,
      productionSigningApproved: false, independentReview: 'NOT_COMPLETED',
      baseline: this.journal.baseline, stage: this.stages()[successful.length] ?? 'complete',
      complete: successful.some(a => a.quote.stage === 'full'), freshlyVerified: this.fresh,
      verification: this.verification && { ...this.verification },
      unresolved: this.pending()?.id ?? null, attempts: structuredClone(this.journal.attempts),
      remainingWalletConfirmations: this.journal.baseline ? this.stages().length - successful.length : null,
    };
  }
  private async nonce() {
    const values = await Promise.all(['latest', 'pending'].map(tag =>
      this.rpc.request<Hex>('eth_getTransactionCount', [p.account, tag])));
    if (quantity(values[0]) !== quantity(values[1])) throw Error('Wallet has another pending transaction');
    return values[0];
  }
  private async checkRisk(adapter: SparkVaultAdapter, block: Block) {
    await inspectForkOwner(this.rpc, p.account, block);
    const implementation = getAddress('0x908CB63Cded85Ee69525E2F95F7f38Da25aE0245');
    for (const [slot, expected] of [
      [keccak256(toHex('org.zeppelinos.proxy.implementation')), implementation],
      [keccak256(toHex('org.zeppelinos.proxy.admin')), getAddress('0x86a2b15f6EF67AF32a6b7C43903cdECb1f540ec1')],
    ] as const) {
      if (decodeStorageAddress(await this.rpc.request('eth_getStorageAt', [p.asset, slot, block.number])) !== expected)
        throw Error('USDC proxy identity changed');
    }
    const code = await this.rpc.request<Hex>('eth_getCode', [implementation, block.number]);
    if (keccak256(code) !== '0x45aaf25df342cc872fb33fca42e4143c905c27dbd2aa6d922cafe8ceb2c834d6')
      throw Error('USDC implementation changed');
    if (await adapter.read<boolean>(walletVaultAbi, p.asset, 'paused', [], block))
      throw Error('USDC is paused');
    for (const address of [p.account, p.vault]) {
      if (await adapter.read<boolean>(walletVaultAbi, p.asset, 'isBlacklisted', [address], block))
        throw Error('USDC participant is blacklisted');
    }
  }
  private async intent(stage: Stage) {
    const adapter = new SparkVaultAdapter(this.rpc), snapshot = await adapter.snapshot(p.account);
    await this.checkRisk(adapter, snapshot.block);
    const allowance = await adapter.read<bigint>(walletVaultAbi, p.asset, 'allowance', [p.account, p.vault], snapshot.block);
    const deposited = this.successful().find(a => a.quote.stage === 'deposit');
    const partial = this.successful().find(a => a.quote.stage === 'partial');
    const expected = partial ? uint(partial.outcome!.remainingShares) : deposited ? uint(deposited.outcome!.shares) : 0n;
    if (snapshot.shares !== expected) throw Error('Wallet shares changed outside this test; stop and inspect');
    let amount = 1000000n, output = 1000000n;
    let data: Hex, to = p.vault as string;
    if (stage === 'approve') {
      if (allowance >= amount) throw Error('Allowance changed; inspect before retrying the approval');
      to = p.asset;
      data = encodeFunctionData({ abi: walletVaultAbi, functionName: 'approve', args: [p.vault, amount] });
    } else if (stage === 'deposit') {
      const [balance, maximum] = await Promise.all([
        adapter.read<bigint>(walletVaultAbi, p.asset, 'balanceOf', [p.account], snapshot.block),
        adapter.read<bigint>(walletVaultAbi, p.vault, 'maxDeposit', [p.account], snapshot.block),
      ]);
      if (balance < amount || allowance < amount || maximum < amount) throw Error('USDC balance, allowance or deposit capacity insufficient');
      output = await adapter.read<bigint>(walletVaultAbi, p.vault, 'previewDeposit', [amount], snapshot.block);
      data = encodeFunctionData({ abi: walletVaultAbi, functionName: 'deposit', args: [amount, p.account] });
    } else {
      amount = stage === 'partial' ? snapshot.shares / 2n : snapshot.shares;
      const plan = vaultPlan(snapshot, amount), preview = await adapter.simulate(plan);
      data = plan.data; output = preview.assets;
    }
    const raw = await this.rpc.request<Hex>('eth_call', [{ from: p.account, to, data, value: '0x0' }, snapshot.block.number]);
    const { decodeFunctionResult } = await import('viem');
    const actual = decodeFunctionResult({ abi: walletVaultAbi,
      functionName: stage === 'approve' ? 'approve' : stage === 'deposit' ? 'deposit' : 'redeem', data: raw });
    if (stage === 'approve' ? actual !== true : actual !== output) throw Error('Call simulation differs from preview');
    await this.rpc.assertBlock(snapshot.block);
    return { snapshot, allowance, to, data, amount, output };
  }
  preview() {
    return this.exclusive(async () => {
      this.quote = null; this.fresh = false;
      if (this.pending() || this.context().complete || this.journal.attempts.length >= 12)
        throw Error('Previous request unresolved or test completed; do not resend');
      for (const attempt of this.successful()) {
        if ((await this.verify(attempt)).status !== 'confirmed')
          throw Error('Previously confirmed transaction changed; inspect before proceeding');
      }
      if (!this.journal.baseline) {
        const adapter = new SparkVaultAdapter(this.rpc), s = await adapter.snapshot(p.account);
        if (s.shares !== 0n) throw Error('This test requires zero initial spUSDC shares');
        const [allowance, balance, maximum] = await Promise.all([
          adapter.read<bigint>(walletVaultAbi, p.asset, 'allowance', [p.account, p.vault], s.block),
          adapter.read<bigint>(walletVaultAbi, p.asset, 'balanceOf', [p.account], s.block),
          adapter.read<bigint>(walletVaultAbi, p.vault, 'maxDeposit', [p.account], s.block),
        ]);
        if (balance < 1000000n || maximum < 1000000n)
          throw Error('At least 1 USDC and available deposit capacity are required before approving');
        await this.rpc.assertBlock(s.block);
        this.journal.baseline = { approvalRequired: allowance < 1000000n, initialAllowance: String(allowance), block: s.block };
        await this.persist();
      }
      const stage = this.stages()[this.successful().length], intent = await this.intent(stage);
      const [nonce, price] = await Promise.all([this.nonce(), this.rpc.gasPrice()]);
      if (price > BigInt(p.gasPriceCapWei)) throw Error('Gas price exceeds the fixed test cap');
      const base = { from: p.account, to: intent.to, value: '0x0' as const, data: intent.data, nonce, gasPrice: hex(price) };
      const gas = ((await this.rpc.estimate(base)) * 120n + 99n) / 100n;
      const q: VaultTestQuote = { id: randomUUID(), stage, expiresAt: this.now() + 90000,
        amount: String(intent.amount), output: String(intent.output), minimumOutput: String(intent.output * 995n / 1000n),
        beforeShares: String(intent.snapshot.shares), maximumGasCostWei: String(gas * price),
        transaction: { ...base, chainId: '0xc4', gas: hex(gas) } };
      this.validateQuote(q);
      if (this.spent() + gas * price > BigInt(p.totalGasCostCapWei)) throw Error('Total test gas budget exceeded');
      this.quote = q; return structuredClone(q);
    });
  }
  reserve(id: unknown, consent: unknown, maximumGasCostWei: unknown) {
    return this.exclusive(async () => {
      const q = this.quote; this.quote = null;
      if (!q || id !== q.id || q.expiresAt <= this.now() || this.pending() ||
          q.stage !== this.context().stage) throw Error('Preview expired or request unresolved; prepare again');
      if (consent !== p.consent || maximumGasCostWei !== q.maximumGasCostWei)
        throw Error('Explicit one-USDC test and fee consent required');
      const intent = await this.intent(q.stage);
      const [nonce, price, gas] = await Promise.all([this.nonce(), this.rpc.gasPrice(), this.rpc.estimate(q.transaction)]);
      if (intent.data !== q.transaction.data || String(intent.snapshot.shares) !== q.beforeShares ||
          intent.output < uint(q.minimumOutput) || nonce !== q.transaction.nonce ||
          price > quantity(q.transaction.gasPrice) || (gas * 120n + 99n) / 100n > quantity(q.transaction.gas) ||
          q.expiresAt <= this.now()) throw Error('Nonce, amount, fee or preview changed; prepare again');
      const attempt: VaultTestAttempt = { id: randomUUID(), status: 'reserved', quote: q, consent: p.consent };
      this.journal.attempts.push(attempt); this.spent(); await this.persist();
      return structuredClone(attempt);
    });
  }
  attachHash(id: unknown, value: unknown) {
    return this.exclusive(async () => {
      hash(value);
      const attempt = this.pending();
      if (!attempt || attempt.id !== id || attempt.hash && attempt.hash !== value.toLowerCase())
        throw Error('Hash differs from the unresolved request');
      attempt.hash = value.toLowerCase() as Hex;
      await this.persist(); return this.context();
    });
  }
  cancel(id: unknown, acknowledgement: unknown) {
    return this.exclusive(async () => {
      const attempt = this.pending();
      if (!attempt || attempt.id !== id || attempt.hash ||
          acknowledgement !== 'WALLET_CANCELLED_NO_PENDING_SIGNATURE') throw Error('Explicit wallet cancellation required');
      await this.rpc.checkChain(196);
      if (quantity(await this.nonce()) !== quantity(attempt.quote.transaction.nonce))
        throw Error('Nonce changed; inspect the wallet before cancelling');
      attempt.status = 'cancelled'; await this.persist(); return this.context();
    });
  }
  private async evidence(value: Hex) {
    const normalizeReceipt = (raw: any) =>
      raw === null ? null : { evidence: receiptEvidence(raw),
        gasUsed: hex(quantity(raw.gasUsed)), effectiveGasPrice: hex(quantity(raw.effectiveGasPrice)) };
    const normalizeTransaction = (raw: any) =>
      raw === null || (raw as any).blockNumber === null ? null : { evidence: minedTransaction(raw),
        nonce: hex(quantity(raw.nonce)), chainId: hex(quantity(raw.chainId)), gas: hex(quantity(raw.gas)) };
    const receipt = normalizeReceipt(await this.rpc.request<any>('eth_getTransactionReceipt', [value], normalizeReceipt));
    const tx = normalizeTransaction(await this.rpc.request<any>('eth_getTransactionByHash', [value], normalizeTransaction));
    if (!receipt || !tx) throw Error('Transaction pending; retain the request without resending');
    return { receipt, tx };
  }
  private async verify(attempt: VaultTestAttempt) {
    if (!attempt.hash) throw Error('Supply the wallet transaction hash first');
    this.verification = { phase: 'receipt', stage: attempt.quote.stage };
    await this.rpc.checkChain(196);
    const evidence = await this.evidence(attempt.hash), { receipt, tx } = evidence;
    assertTransactionIdentity(tx.evidence, receipt.evidence);
    const q = attempt.quote, wanted = q.transaction, r = receipt.evidence;
    if (tx.evidence.hash !== attempt.hash || tx.evidence.from !== p.account || tx.evidence.to !== wanted.to ||
        tx.evidence.input !== wanted.data || quantity(tx.evidence.value) !== 0n ||
        quantity(tx.nonce) !== quantity(wanted.nonce) || quantity(tx.chainId) !== 196n ||
        quantity(receipt.gasUsed) < 21000n || quantity(receipt.gasUsed) > quantity(wanted.gas) ||
        quantity(receipt.gasUsed) > quantity(tx.gas) ||
        quantity(receipt.effectiveGasPrice) > quantity(wanted.gasPrice))
      throw Error('Actual transaction or settled fee differs from consent');
    const block = await this.rpc.block(r.blockNumber), final = await this.rpc.block('finalized');
    if (block.hash !== r.blockHash) throw Error('Receipt block changed');
    const remaining = BigInt(block.number) > BigInt(final.number) ? BigInt(block.number) - BigInt(final.number) : 0n;
    this.verification = { phase: remaining ? 'waiting-finality' : 'balances', stage: q.stage,
      receiptBlock: String(BigInt(block.number)), finalizedBlock: String(BigInt(final.number)),
      blocksRemaining: String(remaining) };
    if (remaining) throw Error('Receipt not finalized; check again without resending');
    const adapter = new SparkVaultAdapter(this.rpc);
    await adapter.verifyDeployment(block);
    let assets = '0', shares = '0', remainingShares = q.beforeShares;
    if (r.status === '0x1' && (q.stage === 'partial' || q.stage === 'full')) {
      const recovered = await inspectVaultRecovery(this.rpc, vaultRecoveryTask(p.account, attempt.hash));
      if (recovered.state !== 'verified' || uint(recovered.shares) !== uint(q.amount) ||
          uint(recovered.assets) < uint(q.minimumOutput) ||
          uint(recovered.remainingShares) !== uint(q.beforeShares) - uint(q.amount))
        throw Error('USDC receipt, remaining shares or finality not matched');
      ({ assets, shares, remainingShares } = recovered);
    } else if (r.status === '0x1') {
      const before = await this.rpc.block(hex(BigInt(block.number) - 1n));
      const [pre, post, preAssets, postAssets, allowance] = await Promise.all([
        adapter.snapshotAt(p.account, before), adapter.snapshotAt(p.account, block),
        adapter.read<bigint>(walletVaultAbi, p.asset, 'balanceOf', [p.account], before),
        adapter.read<bigint>(walletVaultAbi, p.asset, 'balanceOf', [p.account], block),
        adapter.read<bigint>(walletVaultAbi, p.asset, 'allowance', [p.account, p.vault], block),
      ]);
      const events = r.logs.flatMap((log: any) => {
        if (![p.asset, p.vault].includes(log.address)) return [];
        try { return [{ address: log.address, ...decodeEventLog({ abi: walletVaultAbi,
          data: log.data, topics: log.topics, strict: true }) }]; } catch { return []; }
      });
      if (q.stage === 'approve') {
        const approvals = events.filter((event: any) => event.address === p.asset &&
          event.eventName === 'Approval' && event.args.owner === p.account && event.args.spender === p.vault);
        if (approvals.length !== 1 || (approvals[0] as any).args.value !== 1000000n || allowance !== 1000000n ||
            pre.shares !== 0n || post.shares !== 0n || preAssets !== postAssets)
          throw Error('Exact approval or unchanged asset balances not matched');
      } else {
        const deposits = events.filter((event: any) => event.address === p.vault && event.eventName === 'Deposit');
        if (deposits.length !== 1) throw Error('Deposit event missing or ambiguous');
        const deposit: any = deposits[0];
        const transfers = (token: string, from: string, to: string) => events
          .filter((e: any) => e.address === token && e.eventName === 'Transfer' && e.args.from === from && e.args.to === to)
          .reduce((sum: bigint, e: any) => sum + e.args.value, 0n);
        if (deposit.args.sender !== p.account || deposit.args.owner !== p.account ||
            deposit.args.assets !== 1000000n || deposit.args.shares < uint(q.minimumOutput) ||
            deposit.args.shares > 2000000n || pre.shares !== 0n || post.shares !== deposit.args.shares ||
            preAssets - postAssets !== 1000000n || transfers(p.asset, p.account, p.vault) !== 1000000n ||
            transfers(p.vault, zeroAddress, p.account) !== deposit.args.shares)
          throw Error('Deposit events, USDC debit or minted shares not matched');
        assets = '1000000'; shares = String(deposit.args.shares); remainingShares = String(post.shares);
      }
      await this.rpc.assertBlock(before);
    }
    if (!same(evidence, await this.evidence(attempt.hash))) throw Error('Transaction or receipt changed during verification');
    await this.rpc.assertBlock(block); await this.rpc.assertBlock(final);
    return { status: r.status === '0x1' ? 'confirmed' as const : 'reverted' as const,
      outcome: { assets, shares, remainingShares, block, finalized: true as const,
        ...((q.stage === 'partial' || q.stage === 'full') && r.status === '0x1'
          ? { recovery: vaultRecoveryTask(p.account, attempt.hash) } : {}),
        gasUsed: String(quantity(receipt.gasUsed)), effectiveGasPrice: String(quantity(receipt.effectiveGasPrice)) } };
  }
  reconcile() {
    return this.exclusive(async () => {
      this.fresh = false;
      const attempt = this.pending();
      // Check pending finality first; keep every historical verification before persisting success.
      const pendingResult = attempt ? await this.verify(attempt) : null;
      const history = [];
      for (const previous of this.successful()) {
        const checked = await this.verify(previous);
        if (checked.status !== 'confirmed') throw Error('Previously confirmed transaction changed; inspect before proceeding');
        history.push({ attempt: previous, outcome: checked.outcome });
      }
      if (!attempt && !history.length) throw Error('No transaction available to verify');
      for (const previous of history) previous.attempt.outcome = previous.outcome;
      if (attempt && pendingResult) Object.assign(attempt, pendingResult);
      await this.persist();
      this.verification = { phase: 'complete' };
      this.fresh = true; return this.context();
    });
  }
}
