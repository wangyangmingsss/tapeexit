import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { analyzePerformance } from './performance-core.mjs';

const output = 'release-artifacts/performance.json';
await mkdir('release-artifacts', { recursive: true });
await rm(output, { force: true });
const graph = JSON.parse(await readFile('release-artifacts/bundled-modules-production.json', 'utf8'));
const result = analyzePerformance(graph.chunks);
const manifestBytes = await readFile('dist/release-manifest.json');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (manifest.sourceDirty || manifest.sourceCommit !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() ||
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() ||
    graph.lockSha256 !== digest(await readFile('package-lock.json')))
  throw new Error('Performance evidence requires the current clean production build');
const scripts = manifest.files.filter(file => file.path.endsWith('.js'));
if (JSON.stringify(scripts.map(f => f.path).sort()) !== JSON.stringify(graph.chunks.map(c => c.path).sort()))
  throw new Error('Chunk graph differs from release');
for (const chunk of graph.chunks) {
  const bytes = await readFile(`dist/${chunk.path}`);
  const file = scripts.find(file => file.path === chunk.path);
  if (bytes.length !== chunk.bytes || digest(bytes) !== chunk.sha256 || file.sha256 !== chunk.sha256 ||
      file.size !== bytes.length || gzipSync(bytes, { level: 9 }).length !== chunk.gzipBytes)
    throw new Error('Chunk bytes or graph evidence changed');
}
await writeFile(output, JSON.stringify({ schemaVersion: 1, status: 'BUDGET_PASSED',
  sourceCommit: manifest.sourceCommit, manifestSha256: digest(manifestBytes),
  observedAt: new Date().toISOString(), ...result,
  budgets: { initialBytes: 400000, initialGzipBytes: 130000, totalBytes: 600000 },
  scope: 'Static dependency graph and exact JavaScript bytes; gzip level 9 is a compression estimate. ' +
    'Not a network timing, chain publication cost, device benchmark or security review. Deferred files remain in the full recovery release.',
}, null, 2) + '\n');
console.log(`Production JS: ${result.initial.bytes} initial, ${result.deferred.bytes} deferred; SDK outside initial graph.`);
