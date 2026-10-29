import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { RELEASE_APPROVED, SOURCES, SUPPORTED_TOKENS } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';
import { digest, loadPublication } from './publish-core';
import { readBoundedFile, readProjectEvidence } from './evidence-files';
import { assertProfileManifest, parseReleaseProfile, parseReviewAttachments,
  verifyLiveReleaseEvidence, type ReviewAttachment, type SignedReleaseReview,
} from './release-profile-core';

const output = 'release-artifacts/release-preflight.json';
await rm(output, { force: true });
const [path, trustedReviewerKeySha256, ...extra] = process.argv.slice(2);
if (!path || !/^[a-f0-9]{64}$/.test(trustedReviewerKeySha256 ?? '') || extra.length)
  throw new Error('Usage: npm run preflight:release -- <profile.json> <separately-trusted-reviewer-public-key-sha256>');
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw new Error('Development signing gates must remain closed');
const profile = parseReleaseProfile(JSON.parse((await readBoundedFile(path, 2_000_000)).toString()));
const publication = await loadPublication('dist');
assertProfileManifest(profile, publication.contents.find(c => c.file.path === 'release-manifest.json')!.bytes);
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (publication.manifestSha256 !== profile.manifestSha256 ||
    git('rev-parse', 'HEAD') !== profile.sourceCommit || git('status', '--porcelain'))
  throw new Error('Build and profile must match the clean committed source');
const inputs: Record<string, Uint8Array> = {};
for (const [kind, ref] of Object.entries(profile.evidence))
  inputs[kind] = await readProjectEvidence('.', ref);
const attachments = {} as SignedReleaseReview['attachments'];
const refs = parseReviewAttachments(JSON.parse(Buffer.from(inputs.security).toString()).attestation);
const limits = { packet: 64_000, report: 2_000_000, signature: 64, publicKey: 8192 };
for (const [kind, ref] of Object.entries(refs)) {
  const key = kind as ReviewAttachment;
  attachments[key] = await readProjectEvidence('.', ref, limits[key]);
}
const review: SignedReleaseReview = {
  attachments, trustedReviewerKeySha256,
  sourceArchiveSha256: digest(execFileSync('git', ['archive', '--format=tar.gz', profile.sourceCommit],
    { maxBuffer: 32 * 1024 * 1024 })),
  lockfileSha256: digest(await readFile('package-lock.json')),
};
const report = await verifyLiveReleaseEvidence(profile, inputs, review, exit =>
  inspectRecoveryOutcome(new StrictRpc(SOURCES), exit.transactionHash, exit.tokenId, exit.account));
if (git('rev-parse', 'HEAD') !== profile.sourceCommit || git('status', '--porcelain') ||
    (await loadPublication('dist')).manifestSha256 !== profile.manifestSha256)
  throw new Error('Source or build changed during verification');
await mkdir('release-artifacts', { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.status}; production signing gate unchanged.`);
