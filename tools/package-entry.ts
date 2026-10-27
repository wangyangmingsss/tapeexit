import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { digest, loadPublication } from './publish-core';

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
await cp('dist/release-manifest.json', `${root}/release-manifest.json`);
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
  teamName: null, teamMembers: [], contact: null, officialRulesVerifiedAt: null, submissionForm: null,
  actualTapeOutEntry: null, actualContainer: null, mainnetTransaction: null,
  videoEnvironment: 'ISOLATION_DEMO', userEvidence: 'NOT_COLLECTED', submissionReceipt: null,
}, null, 2) + '\n');
await writeFile(`${root}/README.txt`, [
  'TapeExit competition preparation package. DRAFT, NOT SUBMITTED.',
  `Source: ${sourceCommit}`,
  `Manifest SHA-256: ${publication.manifestSha256}`,
  'Video is a labelled local simulation; it is not a live TapeOut or mainnet recording.',
  'Fill submission-fields.json only with actual verified information.',
  'No users, independent review, protocol endorsement or competition submission are implied.',
  'Do not include private keys, credentials or unconsented personal records.',
].join('\n') + '\n');
execFileSync('tar', ['-czf', resolve('release-artifacts/TapeExit-Competition-Draft.tar.gz'), '-C', root, '.']);
console.log('Competition preparation archive created. No external submission performed.');
