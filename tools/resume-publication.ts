import { mkdir, rm, writeFile } from 'node:fs/promises';
import { getAddress } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { loadPublication } from './publish-core';
import { resumePublication } from './resume-publication-core';

const output = 'release-artifacts/resume-plan.json';
await mkdir('release-artifacts', { recursive: true });
await rm(output, { force: true });
if (!process.argv[2]) throw new Error('Usage: npm run plan:resume -- <existing-container>');
const report = await resumePublication(new StrictRpc(SOURCES), getAddress(process.argv[2]), await loadPublication('dist'));
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Checked existing byte prefixes; ${report.transactionCount} unsigned operations remain. Nothing sent.`);
