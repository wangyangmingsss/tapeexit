import { createRequire } from 'node:module';
import { readFile, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { getAddress, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { compareCompiledRuntime, sourceDigest, validateSourceInput } from './runtime-match-core';

const reportPath = 'release-artifacts/runtime-source-match.json';
await rm(reportPath, { force: true });
const [path, trustedDigest, compilerVersion, contract, address, height, ...extra] = process.argv.slice(2);
if (!path || !/^[a-f0-9]{64}$/.test(trustedDigest ?? '') || !compilerVersion || !contract ||
    !address || !/^(0|[1-9][0-9]*)$/.test(height ?? '') || extra.length)
  throw new Error('Usage: npm run verify:runtime-source -- <standard-input.json> <trusted-sha256> ' +
    '<exact-solc-version> <source.sol:Contract> <address> <decimal-block>');
if ((await stat(path)).size > 8 * 1024 * 1024) throw new Error('Source input exceeds 8 MiB');
const bytes = await readFile(path);
if (sourceDigest(bytes) !== trustedDigest) throw new Error('Source input digest differs');
const input = JSON.parse(bytes.toString());
validateSourceInput(input);
const require = createRequire(import.meta.url);
const compiler = require('solc');
if (compiler.version() !== compilerVersion) throw new Error('Installed compiler differs; no remote compiler executed');
input.settings.outputSelection = { '*': { '*': ['evm.deployedBytecode.object'] } };
const output = JSON.parse(compiler.compile(JSON.stringify(input)));
if (output.errors?.some((error: any) => error.severity === 'error')) throw new Error('Source compilation failed');
const separator = contract.lastIndexOf(':');
const bytecode = output.contracts?.[contract.slice(0, separator)]?.[contract.slice(separator + 1)]
  ?.evm?.deployedBytecode?.object;
const rpc = new StrictRpc(SOURCES);
await rpc.checkChain(196);
const block = await rpc.block(`0x${BigInt(height).toString(16)}`);
const runtime = await rpc.request<Hex>('eth_getCode', [getAddress(address), block.number]);
const comparison = compareCompiledRuntime(bytecode, runtime);
await rpc.assertBlock(block);
await mkdir('release-artifacts', { recursive: true });
await writeFile(reportPath, JSON.stringify({
  schemaVersion: 1, chainId: 196, observedAt: new Date().toISOString(),
  address: getAddress(address), block, compilerVersion, contract, sourceInputSha256: trustedDigest,
  ...comparison, limitations: 'Full deployed runtime comparison, including metadata. No library linking or ' +
    'immutable substitution. Source provenance must be reviewed independently. Does not approve behavior, ' +
    'constructor state, proxy implementation, governance or release signing.',
}, null, 2) + '\n');
console.log(comparison.status);
if (!comparison.exact) process.exitCode = 1;
