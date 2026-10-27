import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createLocalServer } from './local-server.mjs';

const manifestBytes = await readFile('dist/release-manifest.json');
const manifest = JSON.parse(manifestBytes);
if (manifest.app !== 'TapeExit' || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || manifest.sourceDirty !== false)
  throw new Error('Build a clean committed release before wallet acceptance');
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== manifest.sourceCommit ||
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Wallet harness requires the clean source commit matching the release manifest');
const root = await mkdtemp(join(tmpdir(), 'tapeexit-wallet-'));
try {
  await cp(resolve('tools/wallet-acceptance'), root, { recursive: true });
  await writeFile(join(root, 'context.json'), JSON.stringify({
    schemaVersion: 1, sourceCommit: manifest.sourceCommit,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    scope: 'Wallet provider connectivity only; no transaction/signature or actual TapeOut-origin acceptance',
  }));
  const server = await createLocalServer(root, 4180);
  const stop = () => server.close(async () => { await rm(root, { recursive: true, force: true }); });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('Wallet acceptance: http://127.0.0.1:4180/ ; no signing or broadcasting methods.');
} catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
