import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { SOURCES, RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { inspectVaultRecovery } from '../src/core/vault-recovery';
import { parseGatewayProfile, assertProfileManifest } from './release-profile-core';
import { parseVaultGatewayRecoveryTask, assertVaultGatewayRecoveryTask } from './vault-gateway-recovery-task';
import { digest } from './publish-core';

const [journalPath, uploadPath, publicationPath, manifestPath, gatewayDirectory, output, ...extra] = process.argv.slice(2);
if (!output || extra.length) throw new Error(
  'Usage: finalize-spark-acceptance.ts wallet-journal upload-journal publication manifest gateway-artifacts output-directory');
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw new Error('Production gates must remain closed');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const profile = parseGatewayProfile(await json('docs/published-gateway-profile.json'));
const task = parseVaultGatewayRecoveryTask(await json('docs/gateway-recovery-task-spark.json'));
const journal = await json(journalPath), upload = await json(uploadPath), publication = await json(publicationPath);
const gateways = await json(`${gatewayDirectory}/verification.json`);
const manifest = await readFile(manifestPath);
assertProfileManifest(profile, manifest);
const hashes = [
  '0x4732646974bc12c94e62c3d361f6d280d8c8d8d1c201e8e2d69089e9833981b1',
  '0x9fa24ac0a7a71ed3f834b13b45bf02ff3e2a01f9f9074c9715e4cfd500c79fc2',
  '0xef317abccd41c1fc709bdf189fa8402c84a2d76c15ad3ee510b7e1daf85c39b5',
  task.recovery.hash,
];
const stages = ['approve', 'deposit', 'partial', 'full'];
if (journal.attempts.length !== 4 || !journal.attempts.every((a: any, i: number) =>
  a.status === 'confirmed' && a.hash === hashes[i] && a.quote.stage === stages[i] && a.outcome?.finalized === true))
  throw new Error('Original wallet coordinator has not confirmed all four expected transactions');
const partial = journal.attempts[2].outcome, full = journal.attempts[3].outcome;
if (partial.assets !== '500000' || partial.shares !== '498083' || partial.remainingShares !== '498084' ||
    full.assets !== task.assets || full.shares !== task.shares || full.remainingShares !== '0' ||
    upload.attempts.length !== 34 || !upload.attempts.every((a: any) => a.status === 'confirmed' && a.hash && a.block))
  throw new Error('Wallet amounts or completed publication count differ');
if (publication.status !== 'published-bytes-checked' || publication.sourceCommit !== profile.sourceCommit ||
    publication.manifestSha256 !== profile.manifestSha256 || publication.containerLive !== true ||
    publication.files.length !== 16 || publication.totalBytes !== 647523)
  throw new Error('Exact publication readback missing');
if (gateways.status !== 'TWO_GATEWAYS_CHECKED' || gateways.recoveryTaskCompleted !== true ||
    gateways.sourceCommit !== profile.sourceCommit || gateways.manifestSha256 !== profile.manifestSha256 ||
    gateways.blockMechanism !== 'HTTPS_CONNECT_PROXY' || gateways.primaryBlockedDuringRecovery !== true ||
    gateways.signingApproved !== false || gateways.views.length !== 4)
  throw new Error('Full public gateway acceptance missing');
await mkdir(output, { recursive: true });
for (const gateway of profile.gateways) {
  for (const view of ['desktop', 'mobile']) {
    const observed = gateways.views.find((v: any) => v.origin === gateway.origin && v.name === view);
    if (!observed || observed.status !== 'PINNED_RELEASE_BYTES_CHECKED' || observed.files.length !== 16 ||
        observed.consoleErrors.length || observed.recoveryTask?.status !== 'FINALIZED_READ_ONLY_RECOVERY_MATCHED' ||
        !observed.recoveryTask.importedRecoveryFile || !observed.recoveryTask.persistedAfterReload ||
        gateway.operator === 'vercel' && !(observed.primaryBlockExercised && observed.blockedPrimaryConnections > 0))
      throw new Error(`Incomplete view: ${gateway.operator}/${view}`);
    const name = `${gateway.operator}-${view}-recovery.json`;
    const exported = await json(`${gatewayDirectory}/${name}`);
    assertVaultGatewayRecoveryTask(task, exported.outcome);
    if (!exported.importedRecoveryFile || !exported.persistedAfterReload || exported.transactionSent !== false)
      throw new Error('Recovery import/reload evidence missing');
    await cp(`${gatewayDirectory}/${name}`, `${output}/${name}`);
    await cp(`${gatewayDirectory}/${gateway.operator}-${view}.png`, `${output}/${gateway.operator}-${view}.png`);
  }
}
const current = assertVaultGatewayRecoveryTask(task, await inspectVaultRecovery(new StrictRpc(SOURCES), task.recovery));
const write = async (name: string, value: unknown) =>
  writeFile(`${output}/${name}`, JSON.stringify(value, null, 2) + '\n');
await write('profile.json', profile);
await write('recovery-task.json', task.recovery);
await write('wallet-test.json', {
  schemaVersion: 1, observedAt: new Date().toISOString(), status: 'RESTRICTED_MAINNET_TEST_FINALIZED',
  sourceContextId: journal.contextId, account: task.recovery.account, chainId: 196,
  transactions: journal.attempts.map((a: any) => ({
    stage: a.quote.stage, hash: a.hash, status: a.status, amount: a.quote.amount, outcome: a.outcome,
  })),
  totalUsdcReturned: '1000002', assetDecimals: 6, remainingShares: '0', remainingWalletConfirmations: 0,
  freshRecovery: current, independentReview: 'NOT_COMPLETED', productionSigningApproved: false,
  scope: 'Original restricted-test journal plus fresh two-source read-only chain verification. ' +
    'The four transactions were signed separately in the original wallet; this packaging tool sends none. ' +
    'Not a post-review production-origin wallet acceptance or an independent security review.',
});
await write('upload-summary.json', {
  schemaVersion: 1, contextId: upload.contextId, confirmedTransactions: 34, remainingTransactions: 0,
  additionalActivationTransaction: false,
  transactions: upload.attempts.map((a: any) => ({ hash: a.hash, block: a.block, gasUsed: a.gasUsed })),
});
await cp(publicationPath, `${output}/publication.json`);
await cp(manifestPath, `${output}/release-manifest.json`);
await cp(`${gatewayDirectory}/verification.json`, `${output}/gateways.json`);
await write('public-acceptance.json', {
  schemaVersion: 1, status: 'PUBLISHED_VAULT_RECOVERY_CHECKED', sourceCommit: profile.sourceCommit,
  verifierSourceCommit: gateways.verifierSourceCommit,
  evidencePackagerSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  evidencePackagerWorkingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  evidencePackagerToolSha256: digest(await readFile(new URL(import.meta.url))),
  observedAt: gateways.observedAt, completedAt: gateways.completedAt,
  manifestSha256: profile.manifestSha256, container: profile.container,
  chainId: 196, files: 16, totalBytes: 647523, views: 4, fileChecks: 64,
  importedRecoveryFile: true, persistedAfterReload: true, finalizedVaultRecovery: true,
  primaryBlockedDuringRecovery: true, blockMechanism: gateways.blockMechanism,
  productionSigningApproved: false, independentReview: 'NOT_COMPLETED',
  scope: 'Public gateway read-only recovery and existing restricted wallet test. No new wallet transaction, ' +
    'post-review production signing acceptance, authenticated backend independence or future availability guarantee.',
});
const names = (await readdir(output)).filter(n => n.endsWith('.json') || n.endsWith('.png')).sort();
await writeFile(`${output}/SHA256SUMS.txt`, (await Promise.all(names.map(async name =>
  `${digest(await readFile(`${output}/${name}`))}  ${name}`))).join('\n') + '\n');
console.log(`Recorded four finalized wallet transactions and 64 public file checks: ${output}`);
