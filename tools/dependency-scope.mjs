import { createHash } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const output = 'release-artifacts/dependency-scope.json';
await rm(output, { force: true });
const lock = await readFile('package-lock.json');
const auditBytes = await readFile('release-artifacts/npm-audit.json');
const audit = JSON.parse(auditBytes);
const context = JSON.parse(await readFile('release-artifacts/npm-audit-context.json', 'utf8'));
const graphBytes = await readFile('release-artifacts/bundled-modules-production.json');
const graph = JSON.parse(graphBytes);
const manifestBytes = await readFile('dist/release-manifest.json');
const manifest = JSON.parse(manifestBytes);
if (context.lockSha256 !== digest(lock) || graph.lockSha256 !== digest(lock) ||
    context.auditSha256 !== digest(auditBytes) || graph.mode !== 'production' ||
    graph.schemaVersion !== 1 || !graph.chunks?.length || !graph.modules?.length ||
    audit.error || !audit.metadata?.vulnerabilities || !audit.vulnerabilities)
  throw new Error('Missing, incomplete or stale dependency inputs; regenerate the audit and production build');
const root = resolve('dist');
for (const chunk of graph.chunks) {
  const path = resolve(root, chunk.path);
  if (!path.startsWith(root + sep) || !manifest.files.some(file => file.path === chunk.path && file.sha256 === chunk.sha256) ||
      digest(await readFile(path)) !== chunk.sha256)
    throw new Error('Module graph does not match the current release chunks');
}
const findings = Object.values(audit.vulnerabilities).map(issue => {
  const nodes = issue.nodes.map(node => {
    const prefix = `<project>/${node}/`;
    const modules = graph.modules.filter(id => id.startsWith(prefix) &&
      !id.slice(prefix.length).startsWith('node_modules/') && !id.slice(prefix.length).includes('/node_modules/'));
    return { path: node, graphModules: modules };
  });
  return {
    name: issue.name, severity: issue.severity, isDirect: issue.isDirect,
    graphPresence: nodes.some(node => node.graphModules.length) ? 'present' : 'not-observed',
    nodes, via: issue.via, fixAvailable: issue.fixAvailable,
    exploitability: 'not-assessed',
  };
});
const result = {
  schemaVersion: 1, sourceCommit: manifest.sourceCommit, sourceDirty: manifest.sourceDirty,
  manifestSha256: digest(manifestBytes), lockSha256: digest(lock),
  auditSha256: digest(auditBytes), moduleGraphSha256: digest(graphBytes), auditObservedAt: context.observedAt,
  scope: 'Static bundler module graph membership only; includes tree-shaken modules. No call-path or exploitability proof.',
  limitations: [
    'not-observed means absent from this generated browser graph, not safe during installation, build or Node tooling',
    'present includes transitive advisory propagation; it does not prove the vulnerable primitive is in the emitted code',
    'No advisory is dismissed, fixed or independently audited by this report',
    'npm audit --omit=dev does not cover all development-tool advisories',
  ],
  summary: { installed: audit.metadata.vulnerabilities,
    presentInGraph: findings.filter(f => f.graphPresence === 'present').length,
    notObservedInGraph: findings.filter(f => f.graphPresence === 'not-observed').length },
  findings,
};
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.summary));
