import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const packages = [];
for (const [path, item] of Object.entries(lock.packages)) {
  if (!path || item.link) continue;
  let metadata = {};
  try { metadata = JSON.parse(await readFile(`${path}/package.json`, 'utf8')); } catch { /* Optional platform packages may be absent. */ }
  packages.push({ path, name: metadata.name || path.split('node_modules/').at(-1), version: item.version,
    license: metadata.license || item.license || 'REVIEW_REQUIRED', integrity: item.integrity,
    development: !!item.dev, optional: !!item.optional });
}
await mkdir('release-artifacts', { recursive: true });
await writeFile('release-artifacts/dependencies.json', JSON.stringify({
  schemaVersion: 1, source: 'package-lock.json', scope: 'Installed dependency graph; not a browser reachability assessment',
  packages,
}, null, 2) + '\n');
await writeFile('release-artifacts/THIRD-PARTY-NOTICES.txt', [
  'TapeExit dependency inventory. Preserve original package license files when redistributing source.',
  'This inventory does not replace the complete license texts in node_modules.',
  ...packages.map(p => `${p.name}@${p.version} | ${typeof p.license === 'string' ? p.license : JSON.stringify(p.license)} | ${p.path}`),
].join('\n') + '\n');
console.log(`Dependency inventory: ${packages.length} locked package paths.`);
const auditPath = 'release-artifacts/npm-audit.json';
const contextPath = 'release-artifacts/npm-audit-context.json';
await rm(auditPath, { force: true });
await rm(contextPath, { force: true });
let audit;
try { audit = execFileSync('npm', ['audit', '--omit=dev', '--json', '--cache', '../work/npm-cache'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (error) {
  if (error.status !== 1 || !error.stdout) throw new Error('Dependency audit unavailable');
  audit = error.stdout;
}
const report = JSON.parse(audit);
if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities)
  throw new Error('Dependency audit did not return a complete result');
const bytes = JSON.stringify(report, null, 2) + '\n';
await writeFile(auditPath, bytes);
await writeFile(contextPath, JSON.stringify({
  schemaVersion: 1, scope: 'npm audit --omit=dev; installed dependency graph, not browser exploitability',
  observedAt: new Date().toISOString(),
  lockSha256: createHash('sha256').update(await readFile('package-lock.json')).digest('hex'),
  auditSha256: createHash('sha256').update(bytes).digest('hex'),
}, null, 2) + '\n');
console.log(`Audit result: ${JSON.stringify(report.metadata.vulnerabilities)}`);
