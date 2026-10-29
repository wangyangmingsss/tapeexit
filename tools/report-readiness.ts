import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadPublication, digest } from './publish-core';
import { RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';
import { loadHistoricalEvidence } from './historical-evidence';

const output = 'release-artifacts/readiness.json';
await mkdir('release-artifacts', { recursive: true });
await rm(output, { force: true });
const publication = await loadPublication('dist');
const manifest = JSON.parse(publication.contents.find(c => c.file.path === 'release-manifest.json')!.bytes.toString());
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== manifest.sourceCommit ||
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Readiness requires the clean source commit matching the release');
const auditBytes = await readFile('release-artifacts/npm-audit.json');
const audit = JSON.parse(auditBytes.toString());
const auditContext = JSON.parse(await readFile('release-artifacts/npm-audit-context.json', 'utf8'));
if (audit.error || !audit.metadata?.vulnerabilities ||
    auditContext.auditSha256 !== digest(auditBytes) ||
    auditContext.lockSha256 !== digest(await readFile('package-lock.json')))
  throw new Error('Regenerate audit evidence for the current lockfile');
const report = {
  schemaVersion: 1, observedAt: new Date().toISOString(), sourceCommit: manifest.sourceCommit,
  manifestSha256: publication.manifestSha256, lockSha256: auditContext.lockSha256,
  status: 'NOT_MAINNET_APPROVED', signingApproved: RELEASE_APPROVED,
  approvedTokenCount: SUPPORTED_TOKENS.length, dependencyFindings: audit.metadata.vulnerabilities,
  historicalPublication: await loadHistoricalEvidence(manifest.sourceCommit),
  requirements: [
    { id: 'asset-review', status: SUPPORTED_TOKENS.length ? 'REQUIRES_REVIEW_EVIDENCE' : 'NO_APPROVED_ASSETS' },
    { id: 'independent-security-review', status: 'HUMAN_VERIFICATION_REQUIRED' },
    { id: 'tapeout-publication-and-readback', status: 'HISTORICAL_RELEASE_CHECKED_CURRENT_CANDIDATE_NOT_PUBLISHED' },
    { id: 'target-wallet-on-real-origin', status: 'PERMISSIONED_EXTERNAL_ACCEPTANCE_REQUIRED' },
    { id: 'public-gateway-fault-rehearsal', status: 'HISTORICAL_READ_ONLY_REHEARSAL_CHECKED_WALLET_TASK_REQUIRED' },
    { id: 'user-validation', status: 'CONSENTED_PARTICIPANTS_REQUIRED' },
    { id: 'competition-submission', status: 'RULES_TEAM_INFORMATION_AND_RECEIPT_REQUIRED' },
  ],
  scope: 'Development status only. Does not trust a self-asserted checklist as independent acceptance. ' +
    'Never changes the signing gate or asset allowlist. Generated tools, fixtures and demo video do not waive external requirements.',
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Readiness: ${report.status}; ${SUPPORTED_TOKENS.length} approved assets. No production gate changed.`);
if (process.argv.includes('--require-approved')) process.exitCode = 1;
