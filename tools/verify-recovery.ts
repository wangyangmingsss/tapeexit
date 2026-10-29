import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { getAddress, type Hex } from 'viem';
import { SOURCES } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { parseTokenId } from '../src/core/token-id';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';

const output = 'release-artifacts/recovery-outcome.json';
await rm(output, { force: true });
const [id, hash, owner, ...extra] = process.argv.slice(2);
if (!id || !/^0x[a-f0-9]{64}$/i.test(hash ?? '') || !owner || extra.length)
  throw new Error('Usage: npm run verify:recovery -- <token-id> <transaction-hash> <expected-owner>');
const result = await inspectRecoveryOutcome(new StrictRpc(SOURCES), hash as Hex, parseTokenId(id), getAddress(owner));
await mkdir('release-artifacts', { recursive: true });
await writeFile(output, JSON.stringify({
  schemaVersion: 1, chainId: 196, environment: 'MAINNET_READ_ONLY',
  observedAt: new Date().toISOString(),
  verifierSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  verifierSourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  ...result, signingApproved: false,
}, null, 2) + '\n');
console.log(`Recovery result: ${result.state}. No wallet request or transaction sent.`);
if (result.state !== 'block-state-matched' || !('receipt' in result) || !result.receipt.finalized)
  process.exitCode = 1;
