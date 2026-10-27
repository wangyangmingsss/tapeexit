import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadPublication } from './publish-core';
import { parseReleaseProfile, verifyReleaseEvidence } from './release-profile-core';

const output = 'release-artifacts/release-preflight.json';
await rm(output, { force: true });
const [path] = process.argv.slice(2);
if (!path || process.argv.length !== 3) throw new Error('Usage: npm run preflight:release -- <profile.json>');
const profile = parseReleaseProfile(JSON.parse(await readFile(path, 'utf8')));
const publication = await loadPublication('dist');
if (publication.manifestSha256 !== profile.manifestSha256 ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== profile.sourceCommit ||
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Build and profile must match the clean committed source');
const root = await realpath('.');
const inputs: Record<string, Uint8Array> = {};
for (const [kind, ref] of Object.entries(profile.evidence)) {
  const file = await realpath(resolve(ref.path));
  if (!file.startsWith(root + sep)) throw new Error('Evidence symlink escapes project');
  const bytes = await readFile(file);
  if (bytes.length > 2_000_000) throw new Error('Evidence exceeds size limit');
  inputs[kind] = bytes;
}
const report = verifyReleaseEvidence(profile, inputs);
await mkdir('release-artifacts', { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.status}; production signing gate unchanged.`);
