import { execFileSync } from 'node:child_process';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';
import { digest, loadPublication } from './publish-core';
import { validateReviewPacket, verifyReviewStatement } from './review-handoff-core';
import { readBoundedFile as boundedRead } from './evidence-files';

const output = 'release-artifacts/independent-review-verification.json';
await rm(output, { force: true });
const [directory, reportFile, signatureFile, publicKeyFile, keyDigest, ...extra] = process.argv.slice(2);
if (!directory || !reportFile || !signatureFile || !publicKeyFile || !keyDigest || extra.length)
  throw new Error('Usage: npm run verify:review -- <packet-directory> <report.json> <binary-signature> <public-key.pem> <trusted-public-key-sha256>');
const packetBytes = await boundedRead(resolve(directory, 'packet.json'), 64_000);
const packet = JSON.parse(packetBytes.toString());
validateReviewPacket(packet);
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw new Error('Development signing gates must remain closed');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== packet.sourceCommit)
  throw new Error('Review packet differs from the current clean source');
for (const [name, expected, limit] of [
  ['source.tar.gz', packet.sourceArchiveSha256, 32 * 1024 * 1024],
  ['release-manifest.json', packet.manifestSha256, 2_000_000],
  ['package-lock.json', packet.lockfileSha256, 4_000_000],
] as const) {
  if (digest(await boundedRead(resolve(directory, name), limit)) !== expected)
    throw new Error(`Review packet artifact changed: ${name}`);
}
if (digest(execFileSync('git', ['archive', '--format=tar.gz', packet.sourceCommit],
  { maxBuffer: 32 * 1024 * 1024 })) !== packet.sourceArchiveSha256 ||
    digest(await readFile('package-lock.json')) !== packet.lockfileSha256)
  throw new Error('Current source archive or lockfile differs');
const publication = await loadPublication('dist');
const manifest = JSON.parse(publication.contents.find(item => item.file.path === 'release-manifest.json')!.bytes.toString());
if (publication.manifestSha256 !== packet.manifestSha256 ||
    manifest.sourceCommit !== packet.sourceCommit)
  throw new Error('Review build differs from the current clean release');
if ((await loadPublication(resolve(directory, 'candidate'))).manifestSha256 !== packet.manifestSha256)
  throw new Error('Review candidate changed');
const result = verifyReviewStatement(packetBytes, await boundedRead(reportFile, 2_000_000),
  await boundedRead(signatureFile, 64), await boundedRead(publicKeyFile, 8192), keyDigest);
if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== packet.sourceCommit)
  throw new Error('Source changed while verifying the review');
await mkdir('release-artifacts', { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(`${result.status}; eligible for human assessment: ${result.eligibleForHumanReleaseAssessment}; signing disabled.`);
if (!result.eligibleForHumanReleaseAssessment) process.exitCode = 1;
