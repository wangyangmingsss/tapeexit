import { beforeEach, expect, it, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { SparkVaultAdapter } from '../src/core/vault-adapter';
import { SPARK_USDC } from '../src/core/vault-config';
import { StrictRpc } from '../src/core/rpc';
import { VAULT_TEST as p, VaultWalletTest, walletVaultAbi, type VaultTestJournal } from '../tools/vault-wallet-core';

beforeEach(() => vi.restoreAllMocks());
function fixture() {
  let now = 10000, gas = 100000n, price = 10000000n, allowance = 0n, shares = 0n, balance = 1014308n;
  let pending = '0x0', latest = pending, fail = false;
  const block = { number: '0x10' as Hex, hash: `0x${'ab'.repeat(32)}` as Hex,
    timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as Hex };
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }]);
  vi.spyOn(SparkVaultAdapter.prototype, 'snapshot').mockImplementation(async () => ({
    protocolId: 'spark-spusdc', vault: p.vault, asset: p.asset, owner: p.account,
    shares, assets: shares, maxRedeem: shares, maxWithdraw: shares, totalAssets: 100000000n,
    liquidAssets: 100000000n, decimals: 6, block,
  }));
  vi.spyOn(SparkVaultAdapter.prototype, 'read').mockImplementation(async <T>(_abi: any, _to: any, name: string) => {
    const value = name === 'allowance' ? allowance : name === 'balanceOf' ? balance :
      name === 'maxDeposit' ? 100000000n : name === 'previewDeposit' ? 1000000n : undefined;
    if (value === undefined) throw Error(`Unexpected read ${name}`);
    return value as T;
  });
  vi.spyOn(VaultWalletTest.prototype as any, 'checkRisk').mockResolvedValue(undefined);
  vi.spyOn(rpc, 'assertBlock').mockResolvedValue();
  vi.spyOn(rpc, 'checkChain').mockResolvedValue();
  vi.spyOn(rpc, 'estimate').mockImplementation(async () => gas);
  vi.spyOn(rpc, 'gasPrice').mockImplementation(async () => price);
  const methods: string[] = [];
  vi.spyOn(rpc, 'request').mockImplementation(async <T>(method: string, args: unknown[]) => {
    methods.push(method);
    if (method === 'eth_getTransactionCount') return (args[1] === 'pending' ? pending : latest) as T;
    if (method === 'eth_call') {
      const tx = args[0] as { data: Hex }, call = decodeFunctionData({ abi: walletVaultAbi, data: tx.data });
      if (call.functionName === 'approve') return encodeFunctionResult({ abi: walletVaultAbi, functionName: 'approve', result: true }) as T;
      return encodeFunctionResult({ abi: walletVaultAbi, functionName: 'deposit', result: 1000000n }) as T;
    }
    throw Error(`Unexpected RPC ${method}`);
  });
  const journal: VaultTestJournal = { schemaVersion: 1, contextId: VaultWalletTest.contextId, baseline: null, attempts: [] };
  const save = vi.fn(async (_value: VaultTestJournal) => { if (fail) throw Error('disk full'); });
  const test = new VaultWalletTest(rpc, journal, { save }, () => now);
  const reserve = async () => { const q = await test.preview(); return test.reserve(q.id, p.consent, q.maximumGasCostWei); };
  return { rpc, test, journal, save, reserve, methods, block,
    allowance: (value: bigint) => { allowance = value; }, shares: (value: bigint) => { shares = value; },
    balance: (value: bigint) => { balance = value; }, gas: (value: bigint) => { gas = value; },
    price: (value: bigint) => { price = value; }, expire: () => { now += 90001; },
    nonce: () => { latest = pending = '0x1'; }, pending: () => { pending = '0x1'; },
    fail: () => { fail = true; },
  };
}
it('prepares an exact one-USDC approval for the fixed vault without sending or opening production', async () => {
  const f = fixture(), q = await f.test.preview();
  const call = decodeFunctionData({ abi: walletVaultAbi, data: q.transaction.data });
  expect(call).toMatchObject({ functionName: 'approve', args: [SPARK_USDC.vault, 1000000n] });
  expect(f.test.context()).toMatchObject({ productionSigningApproved: false, remainingWalletConfirmations: 4 });
  expect(f.methods.every(method => !/send|sign/i.test(method))).toBe(true);
  expect(f.journal.attempts).toHaveLength(0);
});
it('skips a new approval when an existing allowance is sufficient', async () => {
  const f = fixture(); f.allowance(1000000n);
  const q = await f.test.preview();
  expect(q.stage).toBe('deposit');
  expect(f.test.context().remainingWalletConfirmations).toBe(3);
});
it.each(['existing-shares', 'insufficient-USDC'])('stops before any approval on %s', async mode => {
  const f = fixture();
  if (mode === 'existing-shares') f.shares(1n); else f.balance(999999n);
  await expect(f.test.preview()).rejects.toThrow();
  expect(f.journal.attempts).toHaveLength(0);
});
it('requires exact consent and durably saves a reservation before permitting a wallet request', async () => {
  const f = fixture(), q = await f.test.preview();
  await expect(f.test.reserve(q.id, 'yes', q.maximumGasCostWei)).rejects.toThrow('Explicit');
  const a = await f.reserve();
  expect(f.save.mock.calls.at(-1)?.[0].attempts[0]).toEqual(a);
  const restarted = new VaultWalletTest(f.rpc, structuredClone(f.journal), { save: f.save });
  await expect(restarted.preview()).rejects.toThrow('unresolved');
});
it.each(['gas', 'price', 'nonce', 'expiry', 'pending'])('rejects changed %s before reservation', async mode => {
  const f = fixture(), q = await f.test.preview();
  if (mode === 'gas') f.gas(100001n);
  if (mode === 'price') f.price(10000001n);
  if (mode === 'nonce') f.nonce();
  if (mode === 'expiry') f.expire();
  if (mode === 'pending') f.pending();
  await expect(f.test.reserve(q.id, p.consent, q.maximumGasCostWei)).rejects.toThrow();
  expect(f.journal.attempts).toHaveLength(0);
});
it('retains an unknown wallet outcome across restart and never requests another signature', async () => {
  const f = fixture(), a = await f.reserve();
  await expect(f.test.attachHash(a.id, '0x01')).rejects.toThrow('hash');
  const hash = `0x${'cd'.repeat(32)}`;
  await f.test.attachHash(a.id, hash);
  const restarted = new VaultWalletTest(f.rpc, structuredClone(f.journal), { save: f.save });
  expect(restarted.context().unresolved).toBe(a.id);
  await expect(restarted.preview()).rejects.toThrow('unresolved');
  await expect(restarted.attachHash(a.id, `0x${'ef'.repeat(32)}`)).rejects.toThrow('differs');
});
it('requires explicit wallet cancellation and unchanged pending/latest nonce', async () => {
  const f = fixture(), a = await f.reserve();
  await expect(f.test.cancel(a.id, 'assume')).rejects.toThrow('Explicit');
  f.pending();
  await expect(f.test.cancel(a.id, 'WALLET_CANCELLED_NO_PENDING_SIGNATURE')).rejects.toThrow('pending');
  expect(f.test.context().unresolved).toBe(a.id);
});
it('can release an unhashed request only after acknowledged wallet cancellation', async () => {
  const f = fixture(), a = await f.reserve();
  await f.test.cancel(a.id, 'WALLET_CANCELLED_NO_PENDING_SIGNATURE');
  expect(f.test.context().unresolved).toBeNull();
  expect((await f.test.preview()).stage).toBe('approve');
});
it('halts after a journal write failure and refuses to keep operating in memory', async () => {
  const f = fixture(), q = await f.test.preview(); f.fail();
  await expect(f.test.reserve(q.id, p.consent, q.maximumGasCostWei)).rejects.toThrow('disk full');
  await expect(f.test.preview()).rejects.toThrow('Journal write failed');
});
it.each(['target', 'infinite-approval', 'other-recipient', 'status', 'gas'])('rejects a journal with modified %s', async mode => {
  const f = fixture(); await f.reserve();
  const saved = structuredClone(f.journal), a = saved.attempts[0];
  if (mode === 'target') a.quote.transaction.to = p.account;
  if (mode === 'infinite-approval') a.quote.transaction.data = encodeFunctionData({
    abi: walletVaultAbi, functionName: 'approve', args: [p.vault, (1n << 256n) - 1n] });
  if (mode === 'other-recipient') a.quote.transaction.data = encodeFunctionData({
    abi: walletVaultAbi, functionName: 'approve', args: [p.account, 1000000n] });
  if (mode === 'status') a.status = 'confirmed';
  if (mode === 'gas') a.quote.transaction.gas = '0x1000001';
  expect(() => new VaultWalletTest(f.rpc, saved, { save: f.save })).toThrow();
});
it('propagates the deployment/risk identity check instead of continuing to approve', async () => {
  const f = fixture();
  vi.mocked((VaultWalletTest.prototype as any).checkRisk).mockRejectedValue(Error('USDC implementation changed'));
  await expect(f.test.preview()).rejects.toThrow('implementation changed');
  expect(f.journal.attempts).toHaveLength(0);
});
it.each(['revert', 'excess-fee'])('normalizes raw quorum responses before inspecting a %s receipt', async mode => {
  const f = fixture(), attempt = await f.reserve(), tx = attempt.quote.transaction;
  const hash = `0x${'cd'.repeat(32)}` as Hex;
  await f.test.attachHash(attempt.id, hash);
  vi.spyOn(SparkVaultAdapter.prototype, 'verifyDeployment').mockResolvedValue();
  vi.spyOn(f.rpc, 'block').mockResolvedValue(f.block);
  const receipt = { status: '0x0', transactionHash: hash, blockNumber: f.block.number,
    blockHash: f.block.hash, transactionIndex: '0x0', from: p.account, to: p.asset,
    logs: [], gasUsed: '0x5208', effectiveGasPrice: mode === 'excess-fee' ? '0x989681' : tx.gasPrice };
  const actual = { ...tx, hash, input: tx.data, blockNumber: f.block.number,
    blockHash: f.block.hash, transactionIndex: '0x0' };
  vi.mocked(f.rpc.request).mockImplementation(async (method) => {
    if (method === 'eth_getTransactionReceipt') return receipt as any;
    if (method === 'eth_getTransactionByHash') return actual as any;
    throw Error(`Unexpected method ${method}`);
  });
  if (mode === 'excess-fee') {
    await expect(f.test.reconcile()).rejects.toThrow('settled fee differs');
    expect(f.test.context().unresolved).toBe(attempt.id);
  } else {
    expect((await f.test.reconcile()).attempts[0].status).toBe('reverted');
    expect(f.test.context().complete).toBe(false);
  }
});
