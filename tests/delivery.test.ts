import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

it('packages one clean source and rejects mixed channels or altered recovery files', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'tapeexit-delivery-'));
  const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const command = (name: string, args: string[]) =>
    execFileSync(name, args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' }).trim();
  const save = (path: string, value: unknown) => writeFile(resolve(directory, path), JSON.stringify(value));
  try {
    for (const folder of ['dist', 'dist-demo', 'recovery/dist', 'dist-gateway', 'docs'])
      await mkdir(resolve(directory, folder), { recursive: true });
    await writeFile(resolve(directory, '.gitignore'), 'dist/\ndist-demo/\nrecovery/\ndist-gateway/\nrelease-artifacts/\n');
    await save('package.json', { name: 'tapeexit', version: '0.3.0' });
    await save('vercel.json', {});
    await writeFile(resolve(directory, 'README.md'), 'TapeExit');
    await writeFile(resolve(directory, 'docs/RELEASE-CHANNELS.md'), 'Release fixture');
    await cp(resolve('docs/published-gateway-profile.json'),
      resolve(directory, 'docs/published-gateway-profile.json'));
    const publishedProfile = JSON.parse(await readFile(resolve(directory, 'docs/published-gateway-profile.json'), 'utf8'));
    const evidenceDirectory = `docs/evidence/published-${publishedProfile.sourceCommit.slice(0, 7)}`;
    await cp(resolve(evidenceDirectory), resolve(directory, evidenceDirectory), { recursive: true });
    command('git', ['init', '-q']);
    command('git', ['add', '.']);
    command('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
    const sourceCommit = command('git', ['rev-parse', 'HEAD']);
    const identity = { app: 'TapeExit', version: '0.3.0', sourceCommit, sourceDirty: false,
      signingApproved: false, release: `0.3.0-${sourceCommit.slice(0, 7)}`, channel: 'readonly' };
    await save('dist/release-info.json', identity);
    await writeFile(resolve(directory, 'dist/index.html'), '<html>TapeExit</html>');
    const files = [];
    for (const path of ['index.html', 'release-info.json']) {
      const bytes = await readFile(resolve(directory, 'dist', path));
      files.push({ path, size: bytes.length, sha256: sha256(bytes), contentType: path.endsWith('html') ? 'text/html' : 'application/json' });
    }
    await save('dist/release-manifest.json', { ...identity, schemaVersion: 1, chainId: 196, files });
    await cp(resolve(directory, 'dist'), resolve(directory, 'recovery/dist'), { recursive: true });
    await save('dist-demo/release-info.json', { ...identity, channel: 'simulation' });
    await writeFile(resolve(directory, 'dist-gateway/index.html'), '<html>Gateway</html>');
    const packageDelivery = () => command(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'), resolve('tools/package-delivery.ts'),
    ]);
    expect(packageDelivery()).toContain('5 archives');
    const status = JSON.parse(await readFile(resolve(directory, 'release-artifacts/delivery/release-status.json'), 'utf8'));
    expect(status.sourceCommit).toBe(sourceCommit);
    expect(status.channels.gateways.status).toBe('PREPARED_NOT_DEPLOYED');
    expect(status.channels.gateways.recordedPublication.sourceCommit).toBe(publishedProfile.sourceCommit);
    expect(status.channels.gateways.recordedPublication.manifestSha256).toBe(publishedProfile.manifestSha256);
    for (const archive of status.archives)
      expect(sha256(await readFile(resolve(directory, 'release-artifacts/delivery', archive.file)))).toBe(archive.sha256);
    await save('dist-demo/release-info.json', { ...identity, channel: 'simulation', sourceCommit: 'f'.repeat(40) });
    expect(packageDelivery).toThrow(/identities/);
    await save('dist-demo/release-info.json', { ...identity, channel: 'simulation' });
    await writeFile(resolve(directory, 'recovery/dist/index.html'), '<html>Altered</html>');
    expect(packageDelivery).toThrow(/File mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
