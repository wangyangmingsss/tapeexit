import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digest } from '../tools/publish-core';
import { REVIEW_SURFACES } from '../tools/review-handoff-core';

const directories: string[] = [];
const loader = resolve('node_modules/tsx/dist/loader.mjs');
const prepare = resolve('tools/prepare-review.ts');
const verify = resolve('tools/verify-review.ts');
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'tapeexit-archived-review-'));
  directories.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const run = (file: string, args: string[]) => spawnSync(process.execPath,
    ['--import', loader, file, ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
  git('init', '-q');
  git('config', 'user.name', 'Synthetic integration test');
  git('config', 'user.email', 'synthetic@example.invalid');
  await writeFile(join(cwd, '.gitignore'), 'release-artifacts/\ninput/\ndist/\n');
  const lockfile = '{"synthetic":true,"version":1}\n';
  await writeFile(join(cwd, 'package-lock.json'), lockfile);
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic published source');
  const sourceCommit = git('rev-parse', 'HEAD');
  await writeFile(join(cwd, 'package-lock.json'), '{"synthetic":true,"version":2}\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic later development source');
  const publication = join(cwd, 'input/publication');
  await mkdir(publication, { recursive: true });
  const html = Buffer.from('<main>Synthetic test bytes only</main>');
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 1, app: 'TapeExit', chainId: 196, signingApproved: false,
    sourceDirty: false, sourceCommit, files: [
      { path: 'index.html', size: html.length, sha256: digest(html), contentType: 'text/html; charset=utf-8' },
    ],
  }));
  await writeFile(join(publication, 'index.html'), html);
  await writeFile(join(publication, 'release-manifest.json'), manifest);
  const profilePath = join(cwd, 'input/profile.json');
  await writeFile(profilePath, JSON.stringify({
    schemaVersion: 1, chainId: 196, sourceCommit, manifestSha256: digest(manifest),
    container: '0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D', tapeName: '2.2.289.tape',
    gateways: [
      { origin: 'https://2-2-289.netlify.app', operator: 'netlify' },
      { origin: 'https://2-2-289.vercel.app', operator: 'vercel' },
    ],
  }));
  const directory = join(cwd, 'release-artifacts/independent-review', sourceCommit);
  const prepareArgs = ['--published', profilePath, publication];
  const prepared = run(prepare, prepareArgs);
  expect(prepared.status, prepared.stderr).toBe(0);
  const packetBytes = await readFile(join(directory, 'packet.json'));
  const packet = JSON.parse(packetBytes.toString());
  const keys = generateKeyPairSync('ed25519');
  const publicKey = Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' }));
  const report = {
    schemaVersion: 1, packetSha256: digest(packetBytes), sourceCommit,
    manifestSha256: packet.manifestSha256, sourceArchiveSha256: packet.sourceArchiveSha256,
    lockfileSha256: packet.lockfileSha256, reviewedAt: new Date().toISOString(),
    reviewer: { name: 'Synthetic test fixture', contact: 'synthetic@example.invalid',
      independent: true, independenceStatement: 'Synthetic fixture; not a real review' },
    surfaces: REVIEW_SURFACES.map(id => ({ id, reviewed: true, evidence: 'Synthetic test fixture only' })),
    findings: [], exclusions: [], decision: 'APPROVE_REVIEWED_SCOPE',
  };
  const reportBytes = Buffer.from(JSON.stringify(report));
  const reportPath = join(cwd, 'input/report.json'), signaturePath = join(cwd, 'input/report.sig');
  const keyPath = join(cwd, 'input/reviewer-public.pem');
  await writeFile(reportPath, reportBytes);
  await writeFile(signaturePath, sign(null, reportBytes, keys.privateKey));
  await writeFile(keyPath, publicKey);
  const verifyArgs = [directory, reportPath, signaturePath, keyPath, digest(publicKey)];
  return { cwd, run, directory, sourceCommit, packet, lockfile, publication, profilePath, prepareArgs,
    packetBytes, verifyArgs, reportPath, keyPath, output: join(cwd, 'release-artifacts/independent-review-verification.json') };
}

describe('published-source review CLI integration (synthetic signatures only)', () => {
  it('freezes the published commit and its lockfile while HEAD has a different dependency lock', async () => {
    const f = await fixture();
    expect(f.packet.sourceCommit).toBe(f.sourceCommit);
    expect(f.packet.lockfileSha256).toBe(digest(Buffer.from(f.lockfile)));
    expect(await readFile(join(f.directory, 'package-lock.json'), 'utf8')).toBe(f.lockfile);
    expect(await readFile(join(f.directory, 'README.md'), 'utf8')).toContain('--archived');
    const repeated = f.run(prepare, f.prepareArgs);
    expect(repeated.status).not.toBe(0);
    expect(await readFile(join(f.directory, 'packet.json'))).toEqual(f.packetBytes);
  });
  it('authenticates archived scope without a dist build or production approval', async () => {
    const f = await fixture();
    const checked = f.run(verify, ['--archived', ...f.verifyArgs]);
    expect(checked.status, checked.stderr).toBe(0);
    const result = JSON.parse(await readFile(f.output, 'utf8'));
    expect(result).toMatchObject({ verificationMode: 'ARCHIVED_SCOPE_ONLY', sourceCommit: f.sourceCommit,
      signingApproved: false, independenceAuthenticated: false });
    const current = f.run(verify, f.verifyArgs);
    expect(current.status).not.toBe(0);
    expect(current.stderr).toContain('current clean source');
    await expect(readFile(f.output)).rejects.toThrow();
  });
  it.each(['source.tar.gz', 'package-lock.json', 'release-manifest.json', 'candidate/index.html'])(
    'rejects tampered frozen artifact %s and clears a previous verification receipt', async artifact => {
      const f = await fixture();
      expect(f.run(verify, ['--archived', ...f.verifyArgs]).status).toBe(0);
      await writeFile(join(f.directory, artifact), 'tampered synthetic bytes');
      const checked = f.run(verify, ['--archived', ...f.verifyArgs]);
      expect(checked.status).not.toBe(0);
      await expect(readFile(f.output)).rejects.toThrow();
    });
  it('rejects a signed report whose raw bytes changed after signing', async () => {
    const f = await fixture();
    await writeFile(f.reportPath, (await readFile(f.reportPath, 'utf8')) + '\n');
    const checked = f.run(verify, ['--archived', ...f.verifyArgs]);
    expect(checked.status).not.toBe(0);
    expect(checked.stderr).toContain('Invalid Ed25519 review signature');
  });
  it('refuses a publication that differs from the pinned manifest before creating another packet', async () => {
    const f = await fixture();
    const profile = JSON.parse(await readFile(f.profilePath, 'utf8'));
    profile.manifestSha256 = 'f'.repeat(64);
    await writeFile(f.profilePath, JSON.stringify(profile));
    const checked = f.run(prepare, f.prepareArgs);
    expect(checked.status).not.toBe(0);
    expect(checked.stderr).toContain('Profile and internal manifest');
    expect(await readFile(join(f.directory, 'packet.json'))).toEqual(f.packetBytes);
  });
});
