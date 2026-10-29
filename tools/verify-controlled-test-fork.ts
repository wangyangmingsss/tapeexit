import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { V3Adapter } from '../src/core/adapter';
import { ControlledTest, type TestJournal } from './controlled-test-core';
import { TEST_POLICY, checkTestAssets } from './controlled-test-policy';
import { startLocalEvm } from './local-evm';

if (process.argv.length !== 2) throw new Error('Usage: npm run verify:test-fork');
const upstream = new StrictRpc(SOURCES), baseline = await new V3Adapter(upstream).snapshot(BigInt(TEST_POLICY.tokenId));
await checkTestAssets(new V3Adapter(upstream), baseline);
// Replace Anvil's default 1-gwei quote with the observed chain price; never relax the mainnet cap.
const gasPrice = await upstream.gasPrice();
const evm = await startLocalEvm({ url: SOURCES[0].url, block: baseline.block, gasPrice });
try {
  const request = evm.request;
  await request('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000), Number(BigInt(baseline.block.timestamp)) + 1)]);
  for (let i = 0; i < 3; i++) await request('evm_mine');
  await request('anvil_setBalance', [TEST_POLICY.account, '0x8ac7230489e80000']);
  await request('anvil_impersonateAccount', [TEST_POLICY.account]);
  const rpc = new StrictRpc([
    { url: 'http://127.0.0.1', operator: 'same-child-a' },
    { url: 'http://127.0.0.1', operator: 'same-child-b' },
  ], (_source, method, params) => request(method, params));
  let saved: TestJournal = { schemaVersion: 1, contextId: ControlledTest.contextId, attempts: [] };
  const store = { save: async (j: TestJournal) => { saved = structuredClone(j); } };
  const bench = new ControlledTest(rpc, structuredClone(saved), store);
  const q = await bench.preview();
  const reserved = await bench.reserve(q.id, TEST_POLICY.consent, q.maximumGasCostWei);
  // Only this disposable child's IPC transport can submit or impersonate.
  const tx = { ...reserved.quote.transaction };
  const hash = await request('eth_sendTransaction', [tx]) as `0x${string}`;
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('No local transaction hash; do not resubmit');
  await bench.attachHash(reserved.id, hash);
  // Anvil's finalized tag trails the head by 64 blocks.
  for (let i = 0; i < 65; i++) await request('evm_mine');
  const initial = await bench.reconcile();
  const restarted = new ControlledTest(rpc, structuredClone(saved), store);
  const recovered = await restarted.reconcile();
  let repeated = false;
  try { await restarted.preview(); repeated = true; } catch { /* Completion must block a second exit. */ }
  if (!initial.complete || !recovered.complete || repeated) throw new Error('Controlled recovery did not preserve single-exit scope');
  await upstream.assertBlock(baseline.block);
  await mkdir('release-artifacts', { recursive: true });
  await writeFile('release-artifacts/controlled-test-fork-67042.json', JSON.stringify({
    status: 'LOCAL_FORK_EXIT_ARRIVAL_AND_RESTART_RECOVERY_PASSED',
    observedAt: new Date().toISOString(), baselineBlock: baseline.block, localGasPriceWei: gasPrice.toString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    quote: q, result: recovered, repeatedExitBlocked: true,
    limitations: ['Disposable local fork only; no mainnet transaction',
      'Impersonation preserves account delegation code but does not test extension signing',
      'Two local labels share one EVM; upstream baseline was separately checked through two RPC labels',
      'No independent review or asset approval; no actual gateway-origin recovery acceptance'],
  }, null, 2) + '\n');
  console.log('Actual 1% capped exit, arrival, remaining liquidity and restart recovery passed on the local fork. No mainnet write.');
} finally { await evm.close(); }
