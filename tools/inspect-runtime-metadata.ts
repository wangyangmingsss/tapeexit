import { mkdir, rm, writeFile } from 'node:fs/promises';
import { getAddress, type Hex } from 'viem';
import { SOURCES } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { inspectLegacyMetadata } from './runtime-metadata-core';

const output = 'release-artifacts/runtime-metadata.json';
await rm(output, { force: true });
const [address, height, ...extra] = process.argv.slice(2);
if (!address || !/^(0|[1-9][0-9]*)$/.test(height ?? '') || extra.length)
  throw new Error('Usage: npm run inspect:runtime-metadata -- <address> <decimal-block>');
const rpc = new StrictRpc(SOURCES);
await rpc.checkChain(196);
const block = await rpc.block(`0x${BigInt(height).toString(16)}`);
const runtime = await rpc.request<Hex>('eth_getCode', [getAddress(address), block.number]);
const metadata = inspectLegacyMetadata(runtime);
await rpc.assertBlock(block);
await mkdir('release-artifacts', { recursive: true });
await writeFile(output, JSON.stringify({
  schemaVersion: 1, chainId: 196, observedAt: new Date().toISOString(),
  address: getAddress(address), block, runtime, ...metadata,
}, null, 2) + '\n');
console.log(`${metadata.format}; source correspondence remains ${metadata.sourceCorrespondence}.`);
