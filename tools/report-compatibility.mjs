import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { summarizeCompatibility } from './compatibility-core.mjs';
const output = 'release-artifacts/compatibility.json';
await mkdir('release-artifacts', { recursive: true }); await rm(output, { force: true });
const bytes = await readFile('release-artifacts/browser-tests.json');
const report = JSON.parse(bytes);
const manifestBytes = await readFile('dist/release-manifest.json');
const manifest = JSON.parse(manifestBytes);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (manifest.sourceCommit !== commit || manifest.sourceDirty !== false ||
    report.config?.metadata?.sourceCommit !== commit || report.config.metadata.sourceDirty !== false ||
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Browser evidence must match the clean current release');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const result = summarizeCompatibility(report);
await writeFile(output, JSON.stringify({ schemaVersion: 1, status: 'THREE_ENGINE_FIXTURE_MATRIX_PASSED',
  sourceCommit: commit, manifestSha256: digest(manifestBytes), browserReportSha256: digest(bytes),
  observedAt: new Date().toISOString(), ...result }, null, 2) + '\n');
console.log(`${result.passed} browser cases passed across three engines; real extension acceptance remains separate.`);
