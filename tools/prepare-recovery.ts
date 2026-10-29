import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { getAddress, parseAbi } from 'viem';
import { DEPLOYMENT, RELEASE_APPROVED, SOURCES, SUPPORTED_TOKENS } from '../src/config';
import { V3Adapter } from '../src/core/adapter';
import { StrictRpc } from '../src/core/rpc';
import { parseTokenId } from '../src/core/token-id';
import { inspectAssets } from './operations-core';
import { minimumAmounts } from '../src/core/protocol';

const output = 'release-artifacts/controlled-recovery-preparation.json';
await rm(output, { force: true });
const [id, owner, ...extra] = process.argv.slice(2);
if (!id || !owner || extra.length)
  throw new Error('Usage: npm run prepare:recovery -- <token-id> <expected-owner>');
const rpc = new StrictRpc(SOURCES), adapter = new V3Adapter(rpc);
const snapshot = await adapter.snapshot(parseTokenId(id));
if (snapshot.owner !== getAddress(owner)) throw new Error('Position is not directly held by the expected owner');
const assets = await inspectAssets(rpc, [snapshot.token0.address, snapshot.token1.address]);
const blockers: string[] = [];
if (!RELEASE_APPROVED) blockers.push('RELEASE_NOT_APPROVED');
if ([snapshot.token0, snapshot.token1].some(asset => !SUPPORTED_TOKENS.includes(asset.address)))
  blockers.push('ASSETS_NOT_APPROVED');
// This is an informational principal estimate, never a signing plan or a simulated transaction.
const proposedLiquidity = snapshot.liquidity / 100n;
let principalMinimum: string[] | null = null;
if (proposedLiquidity) principalMinimum = minimumAmounts(snapshot, proposedLiquidity, 50, DEPLOYMENT).map(String);
else blockers.push('ONE_PERCENT_ROUNDS_TO_ZERO');
const riskAbi = parseAbi(['function owner() view returns (address)',
  'function isBlocked(address) view returns (bool)']);
const governance = [];
const usdt0 = getAddress('0x779Ded0c9e1022225f8E0630b35a9b54bE713736');
for (const token of [snapshot.token0, snapshot.token1]) {
  if (token.address !== usdt0) continue;
  const issuerOwner = await adapter.read<string>(riskAbi, token.address, 'owner', [], snapshot.block);
  const blocked = [];
  for (const address of [snapshot.owner, snapshot.pool, DEPLOYMENT.manager])
    blocked.push({ address, blocked: await adapter.read<boolean>(riskAbi, token.address,
      'isBlocked', [address], snapshot.block) });
  governance.push({ token: token.address, issuerOwner, blocked,
    controlPolicy: 'NOT_INDEPENDENTLY_REVIEWED',
    risks: ['Issuer blocking can prevent collection', 'Proxy upgrade and OFT governance can change behavior'] });
  if (blocked.some(item => item.blocked)) blockers.push('USDT0_ADDRESS_BLOCKED');
}
await rpc.assertBlock(snapshot.block);
await rpc.assertBlock(assets.block);
await mkdir('release-artifacts', { recursive: true });
await writeFile(output, JSON.stringify({
  schemaVersion: 1, status: 'PREPARATION_ONLY_NOT_AUTHORIZED', environment: 'MAINNET_READ_ONLY',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  observedAt: new Date().toISOString(), chainId: 196, snapshot, assets, governance,
  proposal: { basisPoints: 100, slippageBps: 50, liquidity: proposedLiquidity.toString(),
    principalMinimum, includesFees: false, calldata: null, gasQuote: null, feeAuthorization: null },
  blockers: [...blockers, 'INDEPENDENT_REVIEW_REQUIRED', 'ACTUAL_ORIGIN_WALLET_ACCEPTANCE_REQUIRED',
    'EXPLICIT_TRANSACTION_AND_FEE_CONFIRMATION_REQUIRED'],
  signingApproved: false,
  nextSteps: ['Reviewer checks exact source, release manifest, token source/runtime and issuer governance',
    'Rebuild and publish the reviewed candidate; verify its manifest and actual origin',
    'Read the position again and simulate a fresh plan in the reviewed release',
    'Confirm exact removed liquidity, minimum outputs, recipient, gas ceiling and expiry in the wallet',
    'Verify the returned transaction hash with verify:recovery; retain failed/unknown states without resending'],
  limitations: ['1% is a proposed small liquidity fraction, not a fiat budget or authorization',
    'Principal minimum uses the existing SDK calculation; fees and price movement are not predicted',
    'The two asset observations may use different pinned blocks, recorded separately',
    'No calldata prepared, transaction simulated, approval requested or mainnet write performed'],
}, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
console.log('Read-only controlled recovery preparation saved. No signing plan or fee authorization created.');
