import { mkdir, rm, writeFile } from 'node:fs/promises';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { inspectTapeEnvironment } from './tapeout-environment';

const output = 'release-artifacts/tapeout-environment.json';
await mkdir('release-artifacts', { recursive: true }); await rm(output, { force: true });
const offset = process.argv[2] ?? '0';
if (process.argv.length > 3 || !/^(0|[1-9][0-9]{0,9})$/.test(offset))
  throw new Error('Usage: npm run inspect:tapeout -- [processor-offset]');
const report = await inspectTapeEnvironment(new StrictRpc(SOURCES), BigInt(offset));
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.status}; ${report.processorCount} registered processors; ${report.processors.length} observed. No selection or publication.`);
