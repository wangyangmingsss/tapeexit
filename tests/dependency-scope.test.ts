import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const script = resolve('tools/dependency-scope.mjs');
const roots: string[] = [];
const digest = (data: string) => createHash('sha256').update(data).digest('hex');
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tapeexit-dependency-scope-'));
  roots.push(root);
  await mkdir(join(root, 'release-artifacts'), { recursive: true });
  await mkdir(join(root, 'dist/assets'), { recursive: true });
  const lock = '{}';
  const code = 'console.log("fixture")';
  const issue = (name: string, nodes: string[]) => ({
    name, severity: 'high', isDirect: false, nodes, via: ['upstream'], fixAvailable: false,
  });
  const audit = JSON.stringify({ metadata: { vulnerabilities: { total: 4, high: 4 } }, vulnerabilities: {
    a: issue('a', ['node_modules/a']),
    b: issue('b', ['node_modules/b']),
    nested: issue('nested', ['node_modules/a/node_modules/nested']),
    parent: issue('parent', ['node_modules/only-parent']),
  } });
  await writeFile(join(root, 'package-lock.json'), lock);
  await writeFile(join(root, 'dist/assets/app.js'), code);
  await writeFile(join(root, 'dist/release-manifest.json'), JSON.stringify({
    sourceCommit: 'a'.repeat(40), sourceDirty: false,
    files: [{ path: 'assets/app.js', sha256: digest(code) }],
  }));
  await writeFile(join(root, 'release-artifacts/npm-audit.json'), audit);
  const context = { lockSha256: digest(lock), auditSha256: digest(audit), observedAt: '2026-10-27T00:00:00Z' };
  const graph = { schemaVersion: 1, mode: 'production', lockSha256: digest(lock),
    chunks: [{ path: 'assets/app.js', sha256: digest(code) }],
    modules: ['<project>/node_modules/a/index.js', '<project>/node_modules/b-other/index.js',
      '<project>/node_modules/a/node_modules/nested/index.js',
      '<project>/node_modules/only-parent/node_modules/child/index.js'] };
  await writeFile(join(root, 'release-artifacts/npm-audit-context.json'), JSON.stringify(context));
  await writeFile(join(root, 'release-artifacts/bundled-modules-production.json'), JSON.stringify(graph));
  return { root, context, graph, output: join(root, 'release-artifacts/dependency-scope.json') };
}
it('maps exact installed package paths, preserves propagated issues and never claims exploitability', async () => {
  const f = await fixture();
  await run(process.execPath, [script], { cwd: f.root });
  const report = JSON.parse(await readFile(f.output, 'utf8'));
  expect(report.summary).toMatchObject({ presentInGraph: 2, notObservedInGraph: 2 });
  expect(report.findings.find((f: { name: string }) => f.name === 'b').graphPresence).toBe('not-observed');
  expect(report.findings.every((f: { exploitability: string }) => f.exploitability === 'not-assessed')).toBe(true);
  expect(report.findings[0].via).toEqual(['upstream']);
  expect(report.lockSha256).toBe(f.context.lockSha256);
});
it.each(['lock', 'audit', 'chunk', 'manifest', 'graph', 'missing'] as const)(
  'rejects stale or inconsistent %s evidence and removes an old success report', async fault => {
    const f = await fixture();
    await writeFile(f.output, '{"status":"old-success"}');
    if (fault === 'lock') await writeFile(join(f.root, 'package-lock.json'), '{"changed":true}');
    if (fault === 'audit') await writeFile(join(f.root, 'release-artifacts/npm-audit.json'), '{"error":"offline"}');
    if (fault === 'chunk') await writeFile(join(f.root, 'dist/assets/app.js'), 'tampered');
    if (fault === 'manifest') await writeFile(join(f.root, 'dist/release-manifest.json'), '{"files":[]}');
    if (fault === 'graph') await writeFile(join(f.root, 'release-artifacts/bundled-modules-production.json'),
      JSON.stringify({ ...f.graph, chunks: [{ path: '../outside.js', sha256: '0'.repeat(64) }] }));
    if (fault === 'missing') await rm(join(f.root, 'release-artifacts/npm-audit-context.json'));
    await expect(run(process.execPath, [script], { cwd: f.root })).rejects.toThrow();
    await expect(access(f.output)).rejects.toThrow();
  });
