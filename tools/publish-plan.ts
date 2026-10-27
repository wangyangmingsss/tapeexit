import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { encodeFunctionData, getAddress, parseAbi, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';

const containerInput = process.argv[2];
if (!containerInput) throw new Error('Usage: npm run plan:publish -- <existing-container-address>');
const container = getAddress(containerInput);
const registry = getAddress('0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6');
const binding = getAddress('0x68809fd2fb343aa57d0aeb7f33defe477c9666f9');
const abi = parseAbi([
  'function putFile(address container,string path,string contentType,bytes32 sha256Hash,bytes data)',
  'function appendChunk(address container,string path,uint256 expectIndex,bytes data)',
  'function setFallback(address container,string path)',
  'function monthlyFee() view returns (uint256)',
  'function isContainerLive(address container) view returns (bool)',
]);
const root = await realpath('dist');
const manifestBytes = await readFile(resolve(root, 'release-manifest.json'));
const manifest = JSON.parse(manifestBytes.toString());
if (manifest.app !== 'TapeExit' || manifest.chainId !== 196 || manifest.signingApproved !== false) throw new Error('Unexpected release manifest');
const fileList = [...manifest.files, { path: 'release-manifest.json', contentType: 'application/json',
  size: manifestBytes.length, sha256: createHash('sha256').update(manifestBytes).digest('hex') }]
  .sort((a, b) => Number(a.path === 'index.html') - Number(b.path === 'index.html'));
const transactions: { file: string; chunk: number; to: string; value: string; data: Hex }[] = [];
for (const file of fileList) {
  if (!/^[\w./-]+$/.test(file.path) || file.path.split('/').some((part: string) => !part || part === '.' || part === '..') ||
      file.path === 'sw.js' || file.path.startsWith('.tape/')) throw new Error('Unsafe publish path');
  const path = await realpath(resolve(root, file.path));
  if (!path.startsWith(root + sep)) throw new Error('File escaped dist');
  const bytes = await readFile(path);
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`File mismatch: ${file.path}`);
  for (let offset = 0, chunk = 0; offset < bytes.length || (offset === 0 && !bytes.length); offset += 24000, chunk++) {
    const data = `0x${bytes.subarray(offset, offset + 24000).toString('hex')}` as Hex;
    transactions.push({ file: file.path, chunk, to: registry, value: '0',
      data: chunk === 0 ? encodeFunctionData({ abi, functionName: 'putFile',
        args: [container, `/${file.path}`, file.contentType, `0x${file.sha256}`, data] }) :
        encodeFunctionData({ abi, functionName: 'appendChunk', args: [container, `/${file.path}`, BigInt(chunk), data] }) });
  }
}
transactions.push({ file: '(fallback)', chunk: 0, to: registry, value: '0',
  data: encodeFunctionData({ abi, functionName: 'setFallback', args: [container, '/index.html'] }) });
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
  manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  monthlyActivationFeeWei: BigInt(fee).toString(), containerLive: BigInt(live) === 1n,
  transactionCount: transactions.length, transactions,
  status: 'UNSIGNED_PLAN_ONLY',
  requirements: ['Verify container ownership/open/listing state', 'Review implementation pins',
    'Estimate each transaction and approve a bounded OKB budget', 'Upload in order and read every file back',
    'Activate separately if required; no binding transaction is included'],
}, null, 2) + '\n');
console.log(`Unsigned plan: ${transactions.length} transactions. No signing, upload, activation or payment performed.`);
