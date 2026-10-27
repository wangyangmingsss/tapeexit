import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { digest, preparePublication } from './publish-core';
import { inspectPublication, parsePublishProfile } from './operations-core';

const output = 'release-artifacts/publication-preflight.json';
await mkdir('release-artifacts', { recursive: true });
await rm(output, { force: true });
if (!process.argv[2]) throw new Error('Usage: npm run inspect:publication -- <profile.json>');
const profileBytes = await readFile(process.argv[2]);
const profile = parsePublishProfile(JSON.parse(profileBytes.toString()));
const publication = await preparePublication('dist', profile.container);
const report = await inspectPublication(new StrictRpc(SOURCES), profile, publication.transactions);
await writeFile(output, JSON.stringify({ ...report, profileSha256: digest(profileBytes),
  manifestSha256: publication.manifestSha256 }, null, 2) + '\n');
console.log('Publication identity checked; unsigned report saved. No upload, signing or activation.');
