import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';
import { digest, loadPublication } from './publish-core';
import { REVIEW_SURFACES, type ReviewPacket } from './review-handoff-core';

if (process.argv.length !== 2) throw new Error('Usage: npm run prepare:review');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Review preparation requires a clean committed source');
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw new Error('Development signing gates must remain closed');
const sourceCommit = git('rev-parse', 'HEAD');
const publication = await loadPublication('dist');
const manifest = publication.contents.find(item => item.file.path === 'release-manifest.json')!.bytes;
if (JSON.parse(manifest.toString()).sourceCommit !== sourceCommit)
  throw new Error('Build the exact clean source before freezing review materials');
const lockfile = await readFile('package-lock.json');
const archive = execFileSync('git', ['archive', '--format=tar.gz', sourceCommit], { maxBuffer: 32 * 1024 * 1024 });
const packet: ReviewPacket = {
  schemaVersion: 1, status: 'AWAITING_INDEPENDENT_REVIEW', chainId: 196, sourceCommit,
  manifestSha256: digest(manifest), sourceArchiveSha256: digest(archive), lockfileSha256: digest(lockfile),
  createdAt: new Date().toISOString(), requiredSurfaces: REVIEW_SURFACES, signingApproved: false,
};
const packetBytes = Buffer.from(JSON.stringify(packet, null, 2) + '\n');
const output = `release-artifacts/independent-review/${sourceCommit}`;
if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== sourceCommit)
  throw new Error('Source changed while preparing the review packet');
await mkdir('release-artifacts/independent-review', { recursive: true });
// A packet is immutable: a second attempt must not overwrite a review already in progress.
await mkdir(output);
for (const [name, bytes] of Object.entries({
  'packet.json': packetBytes, 'source.tar.gz': archive, 'release-manifest.json': manifest,
  'package-lock.json': lockfile,
})) await writeFile(`${output}/${name}`, bytes);
for (const item of publication.contents) {
  await mkdir(`${output}/candidate/${item.file.path.split('/').slice(0, -1).join('/')}`, { recursive: true });
  await writeFile(`${output}/candidate/${item.file.path}`, item.bytes);
}
await writeFile(`${output}/review-template.json`, JSON.stringify({
  schemaVersion: 1, packetSha256: digest(packetBytes), sourceCommit,
  manifestSha256: packet.manifestSha256, sourceArchiveSha256: packet.sourceArchiveSha256,
  lockfileSha256: packet.lockfileSha256, reviewedAt: null,
  reviewer: { name: null, contact: null, independent: null, independenceStatement: null },
  surfaces: REVIEW_SURFACES.map(id => ({ id, reviewed: null, evidence: null })),
  findings: null, exclusions: null, decision: null,
}, null, 2) + '\n');
await writeFile(`${output}/README.md`, `# Frozen Independent Review Handoff

Status: AWAITING_INDEPENDENT_REVIEW. Production signing is disabled.
Source: ${sourceCommit}
Packet SHA-256: ${digest(packetBytes)}

Review source.tar.gz, package-lock.json, release-manifest.json and candidate/.
The source contains docs/SECURITY-REVIEW-PACKET.md and docs/CONTROLLED-RECOVERY.md.
The template is intentionally incomplete and cannot pass verification.
Do not modify packet.json or source artifacts. Complete a separate report from review-template.json.
The reviewer signs the exact report bytes with their own Ed25519 key and supplies a detached 64-byte
binary signature and PEM public key. They must never provide their private key.
The recipient confirms the SHA-256 of the PEM public-key file through a separately trusted channel.

Example signature command (run by the reviewer with their existing private key):
openssl pkeyutl -sign -rawin -inkey reviewer-private.pem -in report.json -out report.sig

Verify with:
npm run verify:review -- PACKET_DIRECTORY report.json report.sig reviewer-public.pem TRUSTED_PUBLIC_KEY_SHA256

A valid signature proves possession of the pinned key. It does not prove independence, identity or
accuracy. REQUEST_CHANGES reports are preserved but cannot qualify for human release assessment.
Unresolved/accepted critical or high findings and exclusions also prevent qualification.
Verification never edits configuration, approves assets, publishes or requests wallet signatures.
`);
if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== sourceCommit)
  throw new Error('Source changed during packet creation; do not use the resulting packet');
console.log(`Frozen review packet: ${output}; signing remains disabled.`);
