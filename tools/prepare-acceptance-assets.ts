import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { compileAcceptanceAssets, ACCEPTANCE_SUPPLY, ACCEPTANCE_DEPOSIT } from './acceptance-assets';
import { digest } from './publish-core';
import { RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';

const [directory = 'release-artifacts/acceptance-assets', ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Usage: npm run prepare:acceptance-assets -- [new-output-directory]');
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw new Error('Production signing gates must remain closed');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD'), dirty = !!git('status', '--porcelain');
const compiled = await compileAcceptanceAssets();
const output = resolve(directory);
const lockfileSha256 = digest(await readFile('package-lock.json'));
const openzeppelinLicense = await readFile('contracts/OPENZEPPELIN-LICENSE');
if (git('rev-parse', 'HEAD') !== commit || !!git('status', '--porcelain') !== dirty)
  throw new Error('Source state changed during preparation');
await mkdir(output, { recursive: false });
await writeFile(join(output, 'standard-input.json'), compiled.inputBytes);
await writeFile(join(output, 'OPENZEPPELIN-LICENSE'), openzeppelinLicense);
const artifacts = [];
for (const artifact of compiled.artifacts) {
  const path = `${artifact.contract}.json`;
  const bytes = Buffer.from(JSON.stringify(artifact, null, 2) + '\n');
  await writeFile(join(output, path), bytes);
  artifacts.push({ path, sha256: digest(bytes), contract: artifact.contract, runtimeCodeHash: artifact.runtimeCodeHash });
}
await writeFile(join(output, 'acceptance-assets.json'), JSON.stringify({
  schemaVersion: 1, status: 'PREPARED_NOT_DEPLOYED_NOT_APPROVED', proposedChainId: 196,
  purpose: 'PROTOCOL_ACCEPTANCE_NO_MONETARY_VALUE', sourceCommit: commit, sourceDirty: dirty,
  compilerVersion: compiled.compilerVersion, standardInputSha256: compiled.inputSha256, lockfileSha256,
  initialSupplyPerToken: ACCEPTANCE_SUPPLY.toString(), proposedDepositPerToken: ACCEPTANCE_DEPOSIT.toString(),
  decimals: 18, constructorArguments: [], initialHolder: 'deployment transaction sender', artifacts,
  signingApproved: false, assetApproval: 'NOT_APPROVED', deployment: null, position: null,
}, null, 2) + '\n');
await writeFile(join(output, 'README.txt'), `TapeExit acceptance assets - NO MONETARY VALUE

These assets exist only to test protocol mechanics. No token has been deployed.
Both use pinned OpenZeppelin ERC20 with a one-time constructor mint of 1000 tokens.
There is no external mint, owner, pause, blocklist, proxy, fee or unwrap function.
No funds, approvals, wallet access or gas authorization were requested.
The production asset allowlist remains empty.

Review contracts/AcceptanceToken.sol, all embedded sources, compiler and lockfile.
Use standard-input.json for exact compilation. No constructor arguments are needed.
After deployment, compare FULL runtime including metadata against each artifact.
Creating a position proposes depositing 10 units of EACH token (not 10 OKB or dollars).
Use exact bounded approvals for the existing V3 manager, never unlimited approvals.
Confirm concrete chain, account, token addresses, amount, fees and expiry before writes.
An independent review and a reviewed executable version are still required.
This package cannot replace real-valued-asset review or original-wallet acceptance.
See docs/ACCEPTANCE-ASSETS.md for the deployment and position sequence.
`);
console.log(`Prepared ${output}; sourceDirty=${dirty}; no deployment or signing performed.`);
