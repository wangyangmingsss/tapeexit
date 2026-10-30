import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PRODUCT } from '../src/product';
import { RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';
import { loadPublication } from './publish-core';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('Package delivery from a clean exact-source checkout');
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw new Error('Read-only delivery requires signing disabled');
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const manifestBytes = await readFile('dist/release-manifest.json');
const manifest = JSON.parse(manifestBytes.toString());
const production = await readJson('dist/release-info.json');
const simulation = await readJson('dist-demo/release-info.json');
const recoveryManifest = await readFile('recovery/dist/release-manifest.json');
const { version } = await readJson('package.json');
for (const identity of [manifest, production, simulation]) {
  if (identity.sourceCommit !== sourceCommit || identity.sourceDirty !== false ||
      identity.version !== version || identity.signingApproved !== false)
    throw new Error('Build identities do not match the clean candidate source');
}
if (production.channel !== 'readonly' || simulation.channel !== 'simulation' ||
    !manifestBytes.equals(recoveryManifest)) throw new Error('Delivery channels or recovery bytes differ');
await loadPublication('dist');
await loadPublication('recovery/dist');
const directory = 'release-artifacts/delivery';
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
for (const [from, to] of [['dist', 'application'], ['dist-demo', 'demo'], ['recovery', 'recovery'],
  ['dist-gateway', 'Netlify-Gateway'], ['dist-gateway', 'Vercel-Gateway']] as const)
  await cp(from, `${directory}/${to}`, { recursive: true });
const vercel = await readJson('vercel.json');
await writeFile(`${directory}/Vercel-Gateway/vercel.json`, JSON.stringify({
  ...vercel, buildCommand: null, outputDirectory: '.',
}, null, 2) + '\n');
await cp('README.md', `${directory}/README.md`);
await cp('docs', `${directory}/docs`, { recursive: true });
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const archives: { file: string; sha256: string }[] = [];
for (const name of ['application', 'demo', 'recovery', 'Netlify-Gateway', 'Vercel-Gateway']) {
  const file = `TapeExit-${production.release}-${name}.zip`;
  execFileSync('zip', ['-q', '-r', resolve(directory, file), '.'], { cwd: `${directory}/${name}` });
  archives.push({ file, sha256: sha256(await readFile(`${directory}/${file}`)) });
}
await writeFile(`${directory}/release-status.json`, JSON.stringify({
  schemaVersion: 1, app: PRODUCT.name, version, release: production.release, sourceCommit,
  signingApproved: false, manifestSha256: sha256(manifestBytes),
  channels: {
    github: { sourceCommit },
    demo: { sourceCommit, url: PRODUCT.demo, status: 'BUILT_AWAITING_PAGES_DEPLOYMENT' },
    recovery: { sourceCommit, status: 'PACKAGED', manifestSha256: sha256(recoveryManifest) },
    gateways: { candidateSourceCommit: sourceCommit, status: 'PREPARED_NOT_DEPLOYED',
      recordedPublication: PRODUCT.publication },
  }, archives,
}, null, 2) + '\n');
await writeFile(`${directory}/SHA256SUMS`, archives.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
console.log(`Unified delivery ${production.release}: ${archives.length} archives. Chain publication and hosting are not implied.`);
