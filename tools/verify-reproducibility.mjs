import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const run = promisify(execFile);
const root = process.cwd();
const artifacts = join(root, 'release-artifacts');
await mkdir(artifacts, { recursive: true });
const reportPath = join(artifacts, 'reproducibility.json');
await rm(reportPath, { force: true });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit all source changes before the clean-copy comparison');
const commit = git('rev-parse', 'HEAD');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const lockSha256 = digest(await readFile('package-lock.json'));
const base = resolve(root, '../work');
await mkdir(base, { recursive: true });
const temporary = await mkdtemp(join(base, 'reproduce-'));
const checkout = join(temporary, 'source');
async function command(bin, args) {
  console.log(`Clean copy: ${bin} ${args[0]}`);
  try {
    const result = await run(bin, args, {
      cwd: checkout, timeout: 300000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: 'true' },
    });
    return result.stdout;
  } catch (error) {
    throw new Error(`${bin} ${args[0]} failed: ${String(error.stderr || error.stdout || error.message).slice(-4000)}`);
  }
}
async function snapshot(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await snapshot(join(dir, entry.name), path + '/'));
    else if (entry.isFile()) {
      const bytes = await readFile(join(dir, entry.name));
      files.push({ path, size: bytes.length, sha256: digest(bytes) });
    } else throw new Error('Unexpected link in generated release');
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
try {
  await run('git', ['clone', '--quiet', '--no-local', '--no-hardlinks', root, checkout], { timeout: 30000 });
  await command('git', ['checkout', '--quiet', '--detach', commit]);
  if ((await command('git', ['rev-parse', 'HEAD'])).trim() !== commit) throw new Error('Clean-copy source mismatch');
  await command('npm', ['ci', '--ignore-scripts', '--cache', resolve(root, '../work/npm-cache')]);
  await command('npm', ['run', 'build']);
  const first = await snapshot(join(checkout, 'dist'));
  await command('npm', ['run', 'check:release']);
  await command('npm', ['run', 'build']);
  const second = await snapshot(join(checkout, 'dist'));
  await command('npm', ['run', 'check:release']);
  const local = await snapshot(join(root, 'dist'));
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Repeated clean-copy builds differ');
  if (JSON.stringify(first) !== JSON.stringify(local)) throw new Error('Clean-copy build differs from current local dist');
  if (git('rev-parse', 'HEAD') !== commit || git('status', '--porcelain') ||
      digest(await readFile('package-lock.json')) !== lockSha256)
    throw new Error('Source changed during verification');
  const manifest = JSON.parse(await readFile(join(checkout, 'dist/release-manifest.json'), 'utf8'));
  if (manifest.sourceCommit !== commit || manifest.sourceDirty !== false) throw new Error('Build provenance mismatch');
  await writeFile(reportPath, JSON.stringify({
    schemaVersion: 1, sourceCommit: commit, lockSha256, node: process.version,
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    platform: process.platform, architecture: process.arch, observedAt: new Date().toISOString(),
    status: 'matched', installs: 1, cleanCopyBuilds: 2, comparedWithLocalDist: true,
    installScripts: 'disabled', files: first,
    scope: 'Fresh local Git clone and npm ci, two builds in one OS/toolchain and comparison with local dist. Not independent-machine reproducibility.',
  }, null, 2) + '\n');
  console.log(`Reproducibility matched: ${first.length} files, including the release manifest.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
