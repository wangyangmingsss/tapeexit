import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { inspectAssets } from './operations-core';
import { compareAssetIdentities, parseAssetBaseline } from './asset-identity-core';

const output = 'release-artifacts/asset-identity-verification.json';
await mkdir('release-artifacts', { recursive: true });
await rm(output, { force: true });
const [path, expectedSha256] = process.argv.slice(2);
if (!path || !expectedSha256 || process.argv.length !== 4)
  throw new Error('Usage: npm run verify:assets -- <baseline.json> <independently-saved-baseline-sha256>');
if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error('Asset baseline exceeds 2 MiB');
const baseline = parseAssetBaseline(await readFile(path), expectedSha256);
const rpc = new StrictRpc(SOURCES);
await rpc.checkChain(196);
await rpc.assertBlock(baseline.block);
const current = await inspectAssets(rpc, baseline.assets.map(asset => asset.address));
const comparison = compareAssetIdentities(baseline, current);
await rpc.assertBlock(baseline.block);
await rpc.assertBlock(current.block);
await writeFile(output, JSON.stringify({ schemaVersion: 1, chainId: 196, observedAt: new Date().toISOString(),
  baselineSha256: expectedSha256, ...comparison, current }, null, 2) + '\n');
if (comparison.status === 'ASSET_IDENTITY_CHANGED') {
  console.error(`Asset identity changed in ${comparison.differences.length} fields. Review ${output}; no asset approved.`);
  process.exitCode = 1;
} else console.log(`Observed identities unchanged. ${output}; no asset approved.`);
