import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { encodeFunctionData, getAddress, parseAbi, type Hex } from 'viem';
import { SOURCES, RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';
import { SparkVaultAdapter, vaultPlan } from '../src/core/vault-adapter';
import { SPARK_USDC } from '../src/core/vault-config';
import { importVaultRecovery, inspectVaultRecovery, vaultRecoveryTask } from '../src/core/vault-recovery';
import { StrictRpc } from '../src/core/rpc';
import { startLocalEvm } from './local-evm';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--fork') || args.length > 1) throw new Error('Usage: verify-spark-vault.ts [--fork]');
const owner = getAddress('0x101fd328a0b2fd9e853909651dab1c0b55947c03');
const upstream = new StrictRpc(SOURCES);
const baseline = await new SparkVaultAdapter(upstream).snapshot(owner);
assert.equal(RELEASE_APPROVED, false);
assert.equal(SUPPORTED_TOKENS.length, 0);
await mkdir('release-artifacts/spark-vault', { recursive: true });
const identity = {
  schemaVersion: 1, observedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  deployment: SPARK_USDC, baseline, signingApproved: false, mainnetTransactionsSent: false,
};
const stringify = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
await writeFile('release-artifacts/spark-vault/mainnet.json', stringify({
  ...identity, status: 'TWO_RPC_PINNED_VAULT_READ_PASSED',
  scope: 'Pinned runtime and implementation identity, holder balance and redemption limits. Source provenance is from the official registry; reproducible compiler matching and independent review are not implied.',
}));
if (!args.includes('--fork')) {
  console.log('Actual X Layer Spark spUSDC deployment and holder state checked through two RPC operators; no transaction sent.');
  process.exit(0);
}
const gasPrice = await upstream.gasPrice();
const evm = await startLocalEvm({ url: SOURCES[0].url, block: baseline.block, gasPrice });
try {
  const forkRpc = new StrictRpc([
    { url: 'http://127.0.0.1', operator: 'same-fork-a' },
    { url: 'http://127.0.0.1', operator: 'same-fork-b' },
  ], (_source, method, params) => evm.request(method, params));
  const adapter = new SparkVaultAdapter(forkRpc);
  const before = await adapter.snapshotAt(owner, baseline.block);
  assert.equal(before.shares, baseline.shares);
  assert.equal(before.liquidAssets, baseline.liquidAssets);
  // Isolated fixture: use a fresh account, fund gas and transfer 1 USDC from the
  // vault locally. No bytecode/storage patches and no mainnet signing or funding.
  const tester = getAddress('0x1000000000000000000000000000000000001962');
  await evm.request('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000), Number(BigInt(baseline.block.timestamp)) + 1)]);
  const erc20 = parseAbi(['function transfer(address,uint256) returns (bool)', 'function approve(address,uint256) returns (bool)']);
  const deposit = parseAbi(['function deposit(uint256,address) returns (uint256)']);
  for (const account of [tester, SPARK_USDC.vault]) {
    await evm.request('anvil_setBalance', [account, '0x8ac7230489e80000']);
    await evm.request('anvil_impersonateAccount', [account]);
  }
  async function send(from: string, to: string, data: Hex) {
    const hash = await evm.request('eth_sendTransaction', [{ from, to, data, value: '0x0', gas: '0x1e8480',
      gasPrice: `0x${gasPrice.toString(16)}` }]) as Hex;
    assert.match(hash, /^0x[0-9a-f]{64}$/i);
    for (let i = 0; i < 80; i++) {
      const receipt = await evm.request('eth_getTransactionReceipt', [hash]) as { status: string } | null;
      if (receipt) { assert.equal(receipt.status, '0x1'); return hash; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Local receipt unavailable; no resubmission');
  }
  async function mine(count: number) {
    // Keep each IPC request below the fixed timeout on slower CI runners.
    for (let remaining = count; remaining > 0; remaining -= 5)
      await evm.request('anvil_mine', [`0x${Math.min(5, remaining).toString(16)}`, '0x0']);
  }
  const fundingHash = await send(SPARK_USDC.vault, SPARK_USDC.asset,
    encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [tester, 1_000000n] }));
  const approvalHash = await send(tester, SPARK_USDC.asset,
    encodeFunctionData({ abi: erc20, functionName: 'approve', args: [SPARK_USDC.vault, 1_000000n] }));
  const depositHash = await send(tester, SPARK_USDC.vault,
    encodeFunctionData({ abi: deposit, functionName: 'deposit', args: [1_000000n, tester] }));
  await mine(3);
  const initial = await adapter.snapshot(tester);
  assert.ok(initial.shares > 0n && initial.maxRedeem > 0n);
  const partial = vaultPlan(initial, initial.shares / 2n);
  const preview = await adapter.simulate(partial);
  const partialHash = await send(tester, SPARK_USDC.vault, partial.data);
  await mine(65);
  const task = vaultRecoveryTask(tester, partialHash);
  const recovered = await inspectVaultRecovery(forkRpc, importVaultRecovery(JSON.stringify(task)));
  assert.equal(recovered.state, 'verified');
  if (recovered.state !== 'verified') throw new Error('Partial recovery failed');
  assert.ok(BigInt(recovered.assets) >= preview.assets);
  assert.equal(recovered.remainingShares, preview.remainingShares.toString());
  const remaining = await adapter.snapshot(tester);
  const full = vaultPlan(remaining, remaining.shares);
  await adapter.simulate(full);
  const fullHash = await send(tester, SPARK_USDC.vault, full.data);
  await mine(65);
  const fullResult = await inspectVaultRecovery(forkRpc, vaultRecoveryTask(tester, fullHash));
  assert.equal(fullResult.state, 'verified');
  if (fullResult.state !== 'verified') throw new Error('Full recovery failed');
  assert.equal(fullResult.remainingShares, '0');
  const restarted = await inspectVaultRecovery(forkRpc, importVaultRecovery(JSON.stringify(task)));
  assert.deepEqual(restarted, recovered);
  await upstream.assertBlock(baseline.block);
  await writeFile('release-artifacts/spark-vault/fork.json', stringify({
    ...identity, status: 'ACTUAL_DEPLOYMENT_FORK_DEPOSIT_PARTIAL_FULL_REDEMPTION_AND_RECOVERY_PASSED',
    localFundingHash: fundingHash, localApprovalHash: approvalHash, localDepositHash: depositHash,
    partialPreview: preview, partial: recovered, full: fullResult, restartRecoveryMatched: true,
    limitations: ['Disposable local fork of the actual X Layer proxy and implementation; no mainnet write.',
      'One USDC was transferred from the vault by local impersonation to prepare a fresh test account; gas was locally funded.',
      'No deployed bytecode or storage slots were patched. Test funding and signatures are synthetic.',
      'Both local RPC labels share the same fork. The upstream baseline separately uses two RPC operators.',
      'No real wallet acceptance, independent security review or new public TapeOut publication is implied.'],
  }));
  console.log('Actual Spark vault: deposit, partial/full redemption, USDC receipt, burned shares and restart recovery passed on the isolated fork.');
} finally { await evm.close(); }
