import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { encodeFunctionData, type Hex } from 'viem';
import { SOURCES, RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { SparkVaultAdapter } from '../src/core/vault-adapter';
import { inspectVaultRecovery, importVaultRecovery } from '../src/core/vault-recovery';
import { startLocalEvm } from './local-evm';
import { VAULT_TEST as p, VaultWalletTest, walletVaultAbi, type VaultTestJournal } from './vault-wallet-core';

assert.equal(RELEASE_APPROVED, false);
assert.equal(SUPPORTED_TOKENS.length, 0);
const upstream = new StrictRpc(SOURCES), baseline = await new SparkVaultAdapter(upstream).snapshot(p.account);
assert.equal(baseline.shares, 0n, 'Existing real shares: do not use this one-deposit test');
const gasPrice = await upstream.gasPrice();
const evm = await startLocalEvm({ url: SOURCES[0].url, block: baseline.block, gasPrice });
try {
  const rpc = new StrictRpc([
    { url: 'http://127.0.0.1', operator: 'same-fork-a' },
    { url: 'http://127.0.0.1', operator: 'same-fork-b' },
  ], (_source, method, params) => evm.request(method, params));
  await evm.request('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000),
    Number(BigInt(baseline.block.timestamp)) + 1)]);
  await evm.request('anvil_setBalance', [p.account, '0x8ac7230489e80000']);
  await evm.request('anvil_impersonateAccount', [p.account]);
  const journal: VaultTestJournal = { schemaVersion: 1, contextId: VaultWalletTest.contextId, baseline: null, attempts: [] };
  let saved = structuredClone(journal);
  const store = { save: async (next: VaultTestJournal) => { saved = structuredClone(next); } };
  const test = new VaultWalletTest(rpc, journal, store);
  for (let i = 0; i < 4 && !test.context().complete; i++) {
    const quote = await test.preview();
    const attempt = await test.reserve(quote.id, p.consent, quote.maximumGasCostWei);
    const hash = await evm.request('eth_sendTransaction', [quote.transaction]) as Hex;
    await test.attachHash(attempt.id, hash);
    for (let count = 65; count > 0; count -= 5)
      await evm.request('anvil_mine', [`0x${Math.min(count, 5).toString(16)}`, '0x0']);
    await test.reconcile();
  }
  assert.equal(test.context().complete, true);
  assert.equal(test.context().freshlyVerified, true);
  const restarted = new VaultWalletTest(rpc, structuredClone(saved), store);
  assert.equal(restarted.context().freshlyVerified, false);
  const recovered = await restarted.reconcile();
  assert.equal(recovered.complete, true);
  assert.equal(recovered.freshlyVerified, true);
  await assert.rejects(restarted.preview(), /completed/);
  const final = recovered.attempts.find(a => a.quote.stage === 'full')!;
  assert.equal(final.outcome!.remainingShares, '0');
  const hint = importVaultRecovery(JSON.stringify(final.outcome!.recovery));
  const independentRead = await inspectVaultRecovery(rpc, hint);
  assert.equal(independentRead.state, 'verified');
  const adapter = new SparkVaultAdapter(rpc), snapshot = await adapter.snapshot(p.account);
  const remainingAllowance = await adapter.read<bigint>(walletVaultAbi, p.asset, 'allowance', [p.account, p.vault], snapshot.block);
  if (journal.baseline?.approvalRequired) assert.equal(remainingAllowance, 0n);
  // A changed settled transaction must withdraw the fresh-success label and never authorize another send.
  const guarded = new StrictRpc([
    { url: 'http://127.0.0.1', operator: 'same-fork-a' }, { url: 'http://127.0.0.1', operator: 'same-fork-b' },
  ], async (_source, method, params) => {
    const value = await evm.request(method, params);
    return method === 'eth_getTransactionByHash' && params[0] === final.hash && value
      ? { ...value as object, input: encodeFunctionData({ abi: walletVaultAbi,
        functionName: 'redeem', args: [1n, p.account, p.account] }) } : value;
  });
  const changed = new VaultWalletTest(guarded, structuredClone(saved), store);
  await assert.rejects(changed.reconcile(), /differs/);
  assert.equal(changed.context().freshlyVerified, false);
  await assert.rejects(changed.preview(), /completed/);
  await upstream.assertBlock(baseline.block);
  await mkdir('release-artifacts/spark-vault', { recursive: true });
  await writeFile('release-artifacts/spark-vault/wallet-coordinator-fork.json', JSON.stringify({
    schemaVersion: 1, observedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    status: 'EXACT_WALLET_COORDINATOR_FORK_APPROVAL_DEPOSIT_PARTIAL_FULL_RESTART_AND_IMPORT_PASSED',
    upstreamBaseline: { block: baseline.block, shares: baseline.shares.toString() },
    context: recovered, remainingAllowance: String(remainingAllowance), independentRecovery: independentRead,
    changedTransactionBlocked: true, productionSigningApproved: false, mainnetTransactionsSent: false,
    limitations: ['Actual deployment on a disposable local fork. No mainnet signature or real extension acceptance.',
      'Only gas was synthetically funded; the account already had at least 1 USDC on the fork.',
      'Local RPC labels share one fork; the upstream deployment baseline used two RPC operators.'],
  }, null, 2) + '\n');
  console.log('Exact Spark wallet coordinator passed approval/deposit/partial/full, restart/import recovery and altered-transaction rejection on the isolated fork.');
} finally { await evm.close(); }
