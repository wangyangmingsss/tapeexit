import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { digest, loadPublication } from './publish-core';
import { loadHistoricalEvidence } from './historical-evidence';
import { loadPublishedReleaseEvidence } from './published-release-evidence';

const root = 'release-artifacts/competition';
await rm('release-artifacts/TapeExit-Competition-Draft.tar.gz', { force: true });
const publication = await loadPublication('dist');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const manifest = JSON.parse(publication.contents.find(c => c.file.path === 'release-manifest.json')!.bytes.toString());
if (manifest.sourceCommit !== sourceCommit || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Package only a clean source commit matching the release');
await rm(root, { recursive: true, force: true });
await mkdir(`${root}/docs`, { recursive: true });
await cp('docs/competition', `${root}/docs`, { recursive: true });
await cp('docs/REAL-ACCEPTANCE.md', `${root}/docs/REAL-ACCEPTANCE.md`);
await cp('docs/CONTROLLED-RECOVERY.md', `${root}/docs/CONTROLLED-RECOVERY.md`);
await cp('docs/ASSET-REVIEW-66666.md', `${root}/docs/ASSET-REVIEW-66666.md`);
const historical = await loadHistoricalEvidence(sourceCommit);
const published = await loadPublishedReleaseEvidence();
await cp(published.directory, `${root}/published-evidence`, { recursive: true });
await writeFile(`${root}/published-release.json`, JSON.stringify(published, null, 2) + '\n');
await cp('evidence/historical', `${root}/historical-evidence`, { recursive: true });
await writeFile(`${root}/historical-publication.json`, JSON.stringify(historical, null, 2) + '\n');
await cp('dist/release-manifest.json', `${root}/release-manifest.json`);
for (const name of ['performance', 'business-model', 'pilot-validation', 'browser-tests', 'compatibility'])
  await cp(`release-artifacts/${name}.json`, `${root}/${name}.json`);
const performance = JSON.parse(await readFile(`${root}/performance.json`, 'utf8'));
if (performance.sourceCommit !== sourceCommit || performance.manifestSha256 !== publication.manifestSha256)
  throw new Error('Performance report is stale');
const compatibility = JSON.parse(await readFile(`${root}/compatibility.json`, 'utf8'));
if (compatibility.sourceCommit !== sourceCommit || compatibility.manifestSha256 !== publication.manifestSha256 ||
    compatibility.status !== 'THREE_ENGINE_FIXTURE_MATRIX_PASSED')
  throw new Error('Compatibility report is stale or incomplete');
const business = JSON.parse(await readFile(`${root}/business-model.json`, 'utf8'));
if (business.evidenceLevel !== 'ASSUMPTIONS_ONLY')
  throw new Error('Business assumptions must not be packaged as actual validation');
await cp('release-artifacts/recovery-card', `${root}/recovery-card`, { recursive: true });
const recoveryCard = JSON.parse(await readFile(`${root}/recovery-card/card.json`, 'utf8'));
if (recoveryCard.manifestSha256 !== publication.manifestSha256 ||
    recoveryCard.releaseId !== `${manifest.version}-${sourceCommit.slice(0, 7)}`)
  throw new Error('Printable recovery card is stale');
await cp('release-artifacts/readiness.json', `${root}/readiness.json`);
const readiness = JSON.parse(await readFile(`${root}/readiness.json`, 'utf8'));
if (readiness.sourceCommit !== sourceCommit || readiness.manifestSha256 !== publication.manifestSha256)
  throw new Error('Readiness report is stale');
await writeFile(`${root}/TapeExit-Source.tar.gz`, execFileSync('git', ['archive', '--format=tar.gz', sourceCommit]));
await cp('release-artifacts/demo-video', `${root}/demo-video`, { recursive: true });
const recording = JSON.parse(await readFile(`${root}/demo-video/recording.json`, 'utf8'));
if (recording.sourceCommit !== sourceCommit || recording.environment !== 'ISOLATION_DEMO' ||
    recording.videoSha256 !== digest(await readFile(`${root}/demo-video/TapeExit-Isolation-Demo.webm`)))
  throw new Error('Demo recording does not match the source');
await writeFile(`${root}/submission-fields.json`, JSON.stringify({
  schemaVersion: 1, status: 'DRAFT_NOT_SUBMITTED', sourceCommit,
  manifestSha256: publication.manifestSha256, repository: 'https://github.com/wangyangmingsss/tapeexit',
  entryFields: JSON.parse(await readFile('docs/competition/submission-fields.json', 'utf8')),
  teamName: null, teamMembers: [], contact: null, officialRulesVerifiedOn: '2026-10-31',
  submissionForm: 'https://forms.gle/EoDNbxQ65dev1wFd9',
  actualTapeOutEntry: `tape://${published.tapeName}/`, actualContainer: published.container,
  publishedSourceCommit: published.sourceCommit, publishedManifestSha256: published.manifestSha256,
  candidateMatchesPublishedSource: sourceCommit === published.sourceCommit,
  publicGateways: published.gateways.map(gateway => gateway.origin),
  restrictedVaultTest: published.restrictedWalletTest,
  mainnetTransaction: null, mainnetExitTransaction: null,
  historicalPublicationEvidence: 'historical-publication.json',
  videoEnvironment: 'ISOLATION_DEMO', userEvidence: 'NOT_COLLECTED', submissionReceipt: null,
}, null, 2) + '\n');
await writeFile(`${root}/README.txt`, [
  'TapeExit competition preparation package. DRAFT, NOT SUBMITTED.',
  `Source: ${sourceCommit}`,
  `Manifest SHA-256: ${publication.manifestSha256}`,
  'Video is a labelled local simulation; it is not a live TapeOut or mainnet recording.',
  'published-release.json records the latest uploaded Spark release and its separate source and dates.',
  'published-evidence/ contains the four finalized restricted-wallet transactions and public recovery evidence.',
  'The current source candidate is not automatically deployed or approved by historical observations.',
  'Fill submission-fields.json only with actual verified information.',
  'No users, independent review, protocol endorsement or competition submission are implied.',
  'Do not include private keys, credentials or unconsented personal records.',
].join('\n') + '\n');
execFileSync('tar', ['-czf', resolve('release-artifacts/TapeExit-Competition-Draft.tar.gz'), '-C', root, '.']);
console.log('Competition preparation archive created. No external submission performed.');
