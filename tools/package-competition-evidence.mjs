import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [videoPath, outputPath, ...extra] = process.argv.slice(2);
if (!outputPath || extra.length) throw new Error(
  'Usage: package-competition-evidence.mjs video-directory new-output-directory');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Package from a clean committed checkout');
const output = resolve(outputPath), video = resolve(videoPath);
await mkdir(output);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = 'docs/evidence/published-f8771a8';
const acceptance = await json(`${evidence}/public-acceptance.json`);
const wallet = await json(`${evidence}/wallet-test.json`);
const recording = await json(`${video}/video.json`);
const fields = await json('docs/competition/submission-fields.json');
if (acceptance.status !== 'PUBLISHED_VAULT_RECOVERY_CHECKED' || acceptance.fileChecks !== 64 ||
    wallet.status !== 'RESTRICTED_MAINNET_TEST_FINALIZED' || wallet.remainingShares !== '0' ||
    recording.status !== 'COMPETITION_PITCH_RENDERED' || recording.durationSeconds > 180 ||
    recording.publishedSourceCommit !== acceptance.sourceCommit ||
    recording.evidenceManifestSha256 !== acceptance.manifestSha256 ||
    hash(await readFile(`${video}/TapeExit-Competition-Pitch.mp4`)) !== recording.sha256 ||
    fields.status !== 'PREPARED_NOT_SUBMITTED' || fields.submissionReceipt !== null ||
    fields.productionSigningApproved !== false)
  throw new Error('Competition artifacts are incomplete or inconsistent');
for (const line of (await readFile(`${evidence}/SHA256SUMS.txt`, 'utf8')).trim().split('\n')) {
  const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
  if (!match || hash(await readFile(`${evidence}/${match[2]}`)) !== match[1])
    throw new Error('Published evidence digest mismatch');
}
await cp('docs/competition', `${output}/submission`, { recursive: true });
await cp(evidence, `${output}/evidence`, { recursive: true });
await cp('docs/CURRENT-STATUS.md', `${output}/CURRENT-STATUS.md`);
await cp('README.md', `${output}/README.md`);
for (const name of ['TapeExit-Competition-Pitch.mp4', 'TapeExit-Pitch.zh.srt', 'video.json'])
  await cp(`${video}/${name}`, `${output}/${name}`);
const sourceCommit = git('rev-parse', 'HEAD');
await writeFile(`${output}/TapeExit-Source.tar.gz`,
  execFileSync('git', ['archive', '--format=tar.gz', sourceCommit], { maxBuffer: 64 * 1024 * 1024 }));
await writeFile(`${output}/package.json`, JSON.stringify({
  schemaVersion: 1, status: 'MATERIALS_COMPLETE_NOT_SUBMITTED', createdAt: new Date().toISOString(),
  sourceCommit, publishedSourceCommit: acceptance.sourceCommit,
  manifestSha256: acceptance.manifestSha256, videoSha256: recording.sha256,
  videoDurationSeconds: recording.durationSeconds, productionSigningApproved: false,
  independentReview: 'NOT_COMPLETED', missingEntrantFields: Object.entries(fields)
    .filter(([key, value]) => value === null && key !== 'submissionReceipt').map(([key]) => key),
  submissionReceipt: null,
  scope: 'Final prepared pitch, public chain/gateway evidence, entry text and exact source archive. ' +
    'Does not claim registration, independent review, users, revenue or production signing approval.',
}, null, 2) + '\n');
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...await files(`${directory}/${entry.name}`, `${prefix}${entry.name}/`));
    else result.push(prefix + entry.name);
  }
  return result.sort();
}
const index = await files(output);
await writeFile(`${output}/SHA256SUMS.txt`, (await Promise.all(index.map(async name =>
  `${hash(await readFile(`${output}/${name}`))}  ${name}`))).join('\n') + '\n');
const archive = `${output}.tar.gz`;
execFileSync('tar', ['-czf', archive, '-C', output, '.']);
await writeFile(`${archive}.sha256`, `${hash(await readFile(archive))}  ${archive.split('/').at(-1)}\n`);
console.log(`Prepared ${archive}; ${recording.durationSeconds}s video; no external submission.`);
