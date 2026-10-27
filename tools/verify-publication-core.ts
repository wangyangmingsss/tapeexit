import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, zeroAddress,
  type Abi, type Address, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { BINDING, digest, MAX_FILE_BYTES, REGISTRY, type loadPublication } from './publish-core';

// ABI follows the pinned TapeKit kernel/src/kernel.js and selectors.js.
export const registryReadAbi = parseAbi([
  'function pathCount(address container) view returns (uint256)',
  'function pathsRange(address container,uint256 start,uint256 count) view returns (string[])',
  'function fallbackPath(address container) view returns (string)',
  'function fileInfo(address container,string path) view returns (uint256,string,bytes32,uint256,uint256)',
  'function readRange(address container,string path,uint256 offset,uint256 length) view returns (bytes)',
  'function isContainerLive(address container) view returns (bool)',
]);
type Publication = Awaited<ReturnType<typeof loadPublication>>;
const RANGE_BYTES = 24000;
export async function verifyPublication(rpc: StrictRpc, containerInput: Address, publication: Publication,
  expectedManifestSha256: string) {
  if (!/^[a-f0-9]{64}$/i.test(expectedManifestSha256) ||
      publication.manifestSha256 !== expectedManifestSha256.toLowerCase())
    throw new Error('Trusted manifest digest mismatch');
  const container = getAddress(containerInput);
  if (container === zeroAddress) throw new Error('Zero container');
  const totalBytes = publication.contents.reduce((sum, item) => sum + item.file.size, 0);
  if (totalBytes > 64 * 1024 * 1024 || publication.contents.length > 1001)
    throw new Error('Release exceeds readback limits');
  const expectedPaths = new Set(publication.contents.map(({ file }) => file.path));
  if (expectedPaths.size !== publication.contents.length || !expectedPaths.has('index.html') ||
      !expectedPaths.has('release-manifest.json')) throw new Error('Incomplete release identity');
  // Check all local bytes again before any RPC, including the manifest itself.
  for (const { file, bytes } of publication.contents) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES ||
        bytes.length !== file.size || digest(bytes) !== file.sha256 ||
        (file.path === 'release-manifest.json' && file.sha256 !== publication.manifestSha256))
      throw new Error(`Local file mismatch: ${file.path}`);
  }
  await rpc.checkChain(196);
  const block = await rpc.pin();
  async function read(name: 'pathCount' | 'pathsRange' | 'fallbackPath' | 'fileInfo' | 'readRange' | 'isContainerLive',
    args: readonly unknown[]) {
    const to = name === 'isContainerLive' ? BINDING : REGISTRY;
    const result = await rpc.request<Hex>('eth_call', [{ to,
      data: encodeFunctionData({ abi: registryReadAbi as Abi, functionName: name, args }) }, block.number]);
    return decodeFunctionResult({ abi: registryReadAbi, functionName: name, data: result });
  }
  const code = await rpc.request<Hex>('eth_getCode', [REGISTRY, block.number]);
  if (code === '0x') throw new Error('Registry code missing');
  const count = await read('pathCount', [container]) as bigint;
  if (count !== BigInt(expectedPaths.size)) throw new Error('Published path count mismatch');
  const paths: string[] = [];
  for (let start = 0; start < expectedPaths.size; start += 200) {
    const length = Math.min(200, expectedPaths.size - start);
    const page = await read('pathsRange', [container, BigInt(start), BigInt(length)]) as readonly string[];
    if (page.length !== length) throw new Error('Incomplete registry path page');
    paths.push(...page);
  }
  if (new Set(paths).size !== paths.length || paths.some(path => !expectedPaths.has(path)))
    throw new Error('Published paths differ from the release');
  if (await read('fallbackPath', [container]) !== 'index.html') throw new Error('Published fallback mismatch');
  const verified = [];
  for (const { file, bytes } of publication.contents) {
    const path = file.path;
    const [size, contentType, sha256, updatedAt, chunks] = await read('fileInfo', [container, path]) as
      readonly [bigint, string, Hex, bigint, bigint];
    if (size !== BigInt(file.size) || contentType !== file.contentType ||
        sha256.toLowerCase() !== `0x${file.sha256}` || chunks < 1n || chunks > 350n)
      throw new Error(`Published metadata mismatch: ${path}`);
    const parts: Buffer[] = [];
    for (let offset = 0; offset < file.size; offset += RANGE_BYTES) {
      const length = Math.min(RANGE_BYTES, file.size - offset);
      const hex = await read('readRange', [container, path, BigInt(offset), BigInt(length)]) as Hex;
      const part = Buffer.from(hex.slice(2), 'hex');
      if (part.length !== length) throw new Error(`Incomplete published range: ${path}@${offset}`);
      parts.push(part);
    }
    const actual = Buffer.concat(parts);
    if (digest(actual) !== file.sha256 || !actual.equals(bytes))
      throw new Error(`Published bytes mismatch: ${path}`);
    verified.push({ path, size: file.size, contentType, sha256: file.sha256,
      chunks: chunks.toString(), updatedAt: updatedAt.toString() });
  }
  const containerLive = await read('isContainerLive', [container]) as boolean;
  await rpc.assertBlock(block);
  return { schemaVersion: 1, status: 'published-bytes-checked', chainId: 196, container,
    registry: REGISTRY, registryCodeHash: keccak256(code), binding: BINDING, block,
    manifestSha256: publication.manifestSha256, totalBytes, files: verified,
    fallback: 'index.html', containerLive, operators: rpc.sources,
    scope: 'Fixed-block RPC agreement and exact release bytes. Registry code hash is observed, not approved. ' +
      'Does not verify ownership, implementation approval, origin, wallet, gateway, finality or security. ' +
      'A mutable container may change after this block.' };
}
