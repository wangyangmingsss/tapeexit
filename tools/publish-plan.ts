import { writeFile, mkdir } from 'node:fs/promises';
import { encodeFunctionData, getAddress, parseAbi, zeroAddress, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { preparePublication, REGISTRY as registry } from './publish-core';

const containerInput = process.argv[2];
if (!containerInput) throw new Error('Usage: npm run plan:publish -- <existing-container-address>');
const container = getAddress(containerInput);
if (container === zeroAddress) throw new Error('Zero container');
const binding = getAddress('0x68809fd2fb343aa57d0aeb7f33defe477c9666f9');
const abi = parseAbi([
  'function monthlyFee() view returns (uint256)',
  'function isContainerLive(address container) view returns (bool)',
]);
const { transactions, manifestSha256 } = await preparePublication('dist', container);
const rpc = new StrictRpc(SOURCES);
await rpc.checkChain(196);
const block = await rpc.pin();
const [fee, live] = await Promise.all([
  rpc.request<Hex>('eth_call', [{ to: binding, data: encodeFunctionData({ abi, functionName: 'monthlyFee' }) }, block.number]),
  rpc.request<Hex>('eth_call', [{ to: binding, data: encodeFunctionData({ abi, functionName: 'isContainerLive', args: [container] }) }, block.number]),
]);
await rpc.assertBlock(block);
await mkdir('release-artifacts', { recursive: true });
await writeFile('release-artifacts/publish-plan.json', JSON.stringify({
  schemaVersion: 1, chainId: 196, container, registry, block,
  manifestSha256,
  monthlyActivationFeeWei: BigInt(fee).toString(), containerLive: BigInt(live) === 1n,
  transactionCount: transactions.length, transactions,
  status: 'UNSIGNED_PLAN_ONLY',
  requirements: ['Verify container ownership/open/listing state', 'Review implementation pins',
    'Estimate each transaction and approve a bounded OKB budget', 'Upload in order and read every file back',
    'Activate separately if required; no binding transaction is included'],
}, null, 2) + '\n');
console.log(`Unsigned plan: ${transactions.length} transactions. No signing, upload, activation or payment performed.`);
