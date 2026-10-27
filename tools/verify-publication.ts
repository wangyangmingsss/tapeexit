import { mkdir, rm, writeFile } from 'node:fs/promises';
import { getAddress } from 'viem';
import { SOURCES } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { loadPublication } from './publish-core';
import { verifyPublication } from './verify-publication-core';

const [container, expectedDigest] = process.argv.slice(2);
if (!container || !expectedDigest || process.argv.length !== 4) {
  throw new Error('Usage: npm run verify:publication -- <container-address> <independently-saved-manifest-sha256>');
}
const output = 'release-artifacts/publication-verification.json';
// A failed new attempt must not leave an old success report at this command's output path.
await rm(output, { force: true });
const publication = await loadPublication('dist');
const evidence = await verifyPublication(new StrictRpc(SOURCES), getAddress(container), publication, expectedDigest);
await mkdir('release-artifacts', { recursive: true });
await writeFile(output, JSON.stringify({ ...evidence, checkedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(JSON.stringify({ status: evidence.status, files: evidence.files.length,
  manifestSha256: evidence.manifestSha256, containerLive: evidence.containerLive,
  block: evidence.block, output }, null, 2));
