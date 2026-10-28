import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { DEPLOYMENT, SOURCES } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { parseTokenId } from '../src/core/token-id';
import { V3Adapter } from '../src/core/adapter';
import { startLocalEvm } from './local-evm';
import { runAssetForkMatrix } from './asset-fork-matrix';

const output = 'release-artifacts/asset-fork-matrix.json';
await mkdir('release-artifacts', { recursive: true }); await rm(output, { force: true });
if (process.argv.length < 3 || process.argv.length > 4 ||
    process.argv[3] && !/^--block=(0|[1-9][0-9]*)$/.test(process.argv[3]))
  throw new Error('Usage: npm run verify:asset-fork -- <token-id> [--block=decimal-height]');
const tokenId = parseTokenId(process.argv[2]);
const mainnet = new StrictRpc(SOURCES);
await mainnet.checkChain(196);
const block = process.argv[3] ? await mainnet.block(`0x${BigInt(process.argv[3].slice(8)).toString(16)}`) : await mainnet.pin();
const snapshot = await new V3Adapter(mainnet).snapshotAt(tokenId, block);
const evm = await startLocalEvm({ url: SOURCES[0].url, block });
try {
  await evm.request('evm_setNextBlockTimestamp', [Math.max(Math.floor(Date.now() / 1000), Number(BigInt(block.timestamp)) + 1)]);
  await evm.request('evm_mine'); await evm.request('evm_mine'); await evm.request('evm_mine');
  const rpc = new StrictRpc([{ url: 'http://127.0.0.1', operator: 'same-fork-a' },
    { url: 'http://127.0.0.1', operator: 'same-fork-b' }], (_source, method, params) => evm.request(method, params));
  const fork = await new V3Adapter(rpc).snapshot(tokenId);
  if (fork.owner !== snapshot.owner || fork.liquidity !== snapshot.liquidity ||
      fork.token0.address !== snapshot.token0.address || fork.token1.address !== snapshot.token1.address)
    throw new Error('Fork position differs from independently observed baseline');
  const report = await runAssetForkMatrix(evm.request, rpc, DEPLOYMENT, tokenId);
  await mainnet.assertBlock(block);
  await writeFile(output, JSON.stringify({ schemaVersion: 1, status: 'ISOLATED_ASSET_FORK_MATRIX_PASSED',
    chainId: 196, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    observedAt: new Date().toISOString(), block, manager: DEPLOYMENT.manager, ...report,
    limitations: ['Local fork only; no mainnet writes and no production asset approval',
      'Owner impersonated and funded only in the disposable child EVM',
      'Both local source labels share one EVM; upstream position baseline separately checked with two sources',
      'Six scenarios at one state do not establish issuer identity, upgrade governance, pause/blacklist, tax or rebase safety',
      'No independent review, target-wallet acceptance or future behavior is implied'] }, null, 2) + '\n');
  console.log(`Six isolated fork scenarios passed for position ${tokenId}; assets remain NOT_APPROVED.`);
} finally { await evm.close(); }
