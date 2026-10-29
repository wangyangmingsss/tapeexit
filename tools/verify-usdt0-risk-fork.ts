import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { DEPLOYMENT, SOURCES, WOKB, managerAbi, tokenAbi } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { V3Adapter } from '../src/core/adapter';
import { makePlan } from '../src/core/protocol';
import { parseTokenId } from '../src/core/token-id';
import { startLocalEvm } from './local-evm';
import { inspectForkOwner } from './fork-owner';

const usdt0 = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736' as const;
const governanceAbi = parseAbi(['function owner() view returns (address)',
  'function isBlocked(address) view returns (bool)', 'function addToBlockedList(address)']);
const output = 'release-artifacts/usdt0-blocked-collection-fork.json';
const [id, blockArg] = process.argv.slice(2);
if (!id || !/^--block=(0|[1-9][0-9]*)$/.test(blockArg ?? '') || process.argv.length !== 4)
  throw new Error('Usage: tsx tools/verify-usdt0-risk-fork.ts <token-id> --block=decimal-height');
const tokenId = parseTokenId(id);
const upstream = new StrictRpc(SOURCES), reader = new V3Adapter(upstream);
await upstream.checkChain(196);
const block = await upstream.block(`0x${BigInt(blockArg.slice(8)).toString(16)}`);
const baseline = await reader.snapshotAt(tokenId, block);
if (baseline.token0.address !== usdt0 || baseline.token1.address !== WOKB || !baseline.liquidity)
  throw new Error('This scenario requires a nonempty USDt0/WOKB position');
const tokenOwner = await reader.read<Hex>(governanceAbi, usdt0, 'owner', [], block);
if (await reader.read<boolean>(governanceAbi, usdt0, 'isBlocked', [baseline.pool], block))
  throw new Error('Baseline pool is already blocked');
const ownerAccount = await inspectForkOwner(upstream, baseline.owner, block);
const evm = await startLocalEvm({ url: SOURCES[0].url, block });
try {
  await evm.request('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000), Number(BigInt(block.timestamp)) + 1)]);
  for (let i = 0; i < 3; i++) await evm.request('evm_mine');
  const rpc = new StrictRpc([{ url: 'http://127.0.0.1', operator: 'same-fork-a' },
    { url: 'http://127.0.0.1', operator: 'same-fork-b' }], (_source, method, params) => evm.request(method, params));
  const adapter = new V3Adapter(rpc, DEPLOYMENT, [usdt0, WOKB]);
  const initial = await adapter.snapshot(tokenId);
  if (initial.owner !== baseline.owner || initial.pool !== baseline.pool || initial.liquidity !== baseline.liquidity ||
      await adapter.read<string>(governanceAbi, usdt0, 'owner', [], initial.block) !== tokenOwner ||
      JSON.stringify(await inspectForkOwner(rpc, initial.owner, initial.block)) !== JSON.stringify(ownerAccount))
    throw new Error('Fork differs from the two-source baseline');
  for (const account of [tokenOwner, initial.owner]) {
    await evm.request('anvil_setBalance', [account, '0x8ac7230489e80000']);
    await evm.request('anvil_impersonateAccount', [account]);
  }
  async function send(from: string, to: string, data: Hex) {
    const hash = await evm.request('eth_sendTransaction', [{ from, to, data, value: '0x0', gas: '0x1e8480' }]) as Hex;
    if (!/^0x[a-f0-9]{64}$/i.test(hash)) throw new Error('Unknown local submission; no retry');
    for (let attempt = 0; attempt < 50; attempt++) {
      const receipt = await evm.request('eth_getTransactionReceipt', [hash]) as
        { status: string; logs: unknown[] } | null;
      if (receipt) {
        if (!['0x0', '0x1'].includes(receipt.status) || !Array.isArray(receipt.logs))
          throw new Error('Malformed local receipt');
        return { hash, receipt };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Local receipt unavailable; no resubmission');
  }
  const blockedTx = await send(tokenOwner, usdt0, encodeFunctionData({
    abi: governanceAbi, functionName: 'addToBlockedList', args: [initial.pool],
  }));
  if (blockedTx.receipt.status !== '0x1') throw new Error('Local block-list preparation failed');
  for (let i = 0; i < 3; i++) await evm.request('evm_mine');
  const snapshot = await adapter.snapshot(tokenId);
  if (!await adapter.read<boolean>(governanceAbi, usdt0, 'isBlocked', [snapshot.pool], snapshot.block))
    throw new Error('Pool did not become blocked in the local fork');
  const plan = makePlan(snapshot, snapshot.owner, 10000, 50, false, DEPLOYMENT);
  // First prove decrease itself succeeds; the combined call must fail at collection.
  const decrease = encodeFunctionData({ abi: managerAbi, functionName: 'decreaseLiquidity', args: [{
    tokenId, liquidity: plan.liquidity, amount0Min: plan.amount0Min, amount1Min: plan.amount1Min,
    deadline: plan.deadline!,
  }] });
  await rpc.request('eth_call', [{ from: snapshot.owner, to: DEPLOYMENT.manager, data: decrease }, 'latest']);
  let simulationError = '';
  try { await adapter.simulate(plan); }
  catch (error) { simulationError = String(error); }
  if (!simulationError) throw new Error('Application simulation accepted a blocked collection');
  let rawCallError = '';
  try { await evm.request('eth_call', [{ from: snapshot.owner, to: DEPLOYMENT.manager, data: plan.data }, 'latest']); }
  catch (error) { rawCallError = String(error); }
  if (!/execution reverted: TF(?:\s|$)/.test(rawCallError))
    throw new Error(`Expected local transfer rejection, observed: ${rawCallError}`);
  async function balances() {
    return Promise.all(([usdt0, WOKB] as const).map(async token => {
      const data = await rpc.request<Hex>('eth_call', [{
        to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'balanceOf', args: [snapshot.owner] }),
      }, 'latest']);
      return decodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', data });
    }));
  }
  const before = await balances();
  const failed = await send(snapshot.owner, DEPLOYMENT.manager, plan.data);
  const after = await balances();
  for (let i = 0; i < 3; i++) await evm.request('evm_mine');
  const remaining = await adapter.snapshot(tokenId);
  if (failed.receipt.status !== '0x0' || failed.receipt.logs.length ||
      after.some((amount, i) => amount !== before[i]) || remaining.owner !== snapshot.owner ||
      remaining.liquidity !== snapshot.liquidity || remaining.owed0 !== snapshot.owed0 ||
      remaining.owed1 !== snapshot.owed1)
    throw new Error('Blocked collection did not roll back the whole multicall');
  await upstream.assertBlock(block);
  await mkdir('release-artifacts', { recursive: true });
  await writeFile(output, JSON.stringify({
    schemaVersion: 1, status: 'ISOLATED_BLOCKED_COLLECTION_ROLLBACK_PASSED',
    observedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    chainId: 196, block, tokenId: id, owner: snapshot.owner, ownerAccount, tokenOwner,
    pool: snapshot.pool, blockedPreparationHash: blockedTx.hash, localFailedHash: failed.hash,
    simulationError, rawCallError, balanceDeltas: after.map((amount, i) => String(amount - before[i])),
    remainingLiquidity: String(remaining.liquidity), decreaseCallSucceeded: true,
    approval: 'NOT_APPROVED',
    limitations: ['No mainnet writes. All state changes use the disposable child EVM IPC.',
      'Token owner and wallet are impersonated locally; owner funding and pool block-list state are intentionally changed.',
      'Governance authorization, target-extension signing, bridge security and future upgrades are not tested.',
      'Both fork RPC labels share one EVM; upstream baseline separately uses two sources.'],
  }, null, 2) + '\n');
  console.log('Blocked USDt0 collection reverted atomically; production assets remain NOT_APPROVED.');
} finally { await evm.close(); }
