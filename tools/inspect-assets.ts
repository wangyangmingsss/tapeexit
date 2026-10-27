import { mkdir, rm, writeFile } from 'node:fs/promises';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { inspectAssets } from './operations-core';

const output = 'release-artifacts/asset-candidates.json';
await mkdir('release-artifacts', { recursive: true });
await rm(output, { force: true });
const report = await inspectAssets(new StrictRpc(SOURCES), process.argv.slice(2));
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Observed ${report.assets.length} candidates. None approved; production allowlist unchanged.`);
