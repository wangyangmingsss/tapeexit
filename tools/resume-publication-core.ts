import { decodeFunctionResult, encodeFunctionData, getAddress, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { REGISTRY, digest, encodePublishFile, fallbackTransaction, type loadPublication } from './publish-core';
import { registryReadAbi } from './verify-publication-core';

export async function resumePublication(rpc: StrictRpc, containerInput: Address,
  publication: Awaited<ReturnType<typeof loadPublication>>) {
  const container = getAddress(containerInput);
  if (container === zeroAddress) throw new Error('Zero container');
  const contents = publication.contents;
  if (!contents.length || contents.length > 1001 ||
      contents.reduce((sum, c) => sum + c.bytes.length, 0) > 64 * 1024 * 1024)
    throw new Error('Publication exceeds resume limits');
  const manifest = contents.find(c => c.file.path === 'release-manifest.json');
  if (!manifest || digest(manifest.bytes) !== publication.manifestSha256 ||
      contents.some(c => c.bytes.length !== c.file.size || digest(c.bytes) !== c.file.sha256))
    throw new Error('Local publication bytes changed');
  const expectedPaths = new Set(contents.map(c => c.file.path));
  if (expectedPaths.size !== contents.length) throw new Error('Duplicate local publication path');
  await rpc.checkChain(196);
  const block = await rpc.pin();
  const code = await rpc.request<Hex>('eth_getCode', [REGISTRY, block.number]);
  if (!/^0x(?:[a-f0-9]{2})+$/i.test(code)) throw new Error('Registry code missing');
  async function read(name: string, args: readonly unknown[]) {
    const data = await rpc.request<Hex>('eth_call', [{ to: REGISTRY,
      data: encodeFunctionData({ abi: registryReadAbi as Abi, functionName: name, args }) }, block.number]);
    return decodeFunctionResult({ abi: registryReadAbi as Abi, functionName: name, data });
  }
  const count = await read('pathCount', [container]) as bigint;
  if (count > BigInt(contents.length)) throw new Error('Unexpected existing registry paths');
  const existing: string[] = [];
  for (let offset = 0n; offset < count; offset += 200n) {
    const length = count - offset > 200n ? 200n : count - offset;
    const page = await read('pathsRange', [container, offset, length]) as readonly string[];
    if (page.length !== Number(length)) throw new Error('Incomplete registry path enumeration');
    existing.push(...page);
  }
  if (new Set(existing).size !== existing.length || existing.some(path => !expectedPaths.has(path)))
    throw new Error('Unexpected or duplicate existing registry path');
  const seen = new Set(existing), checked = [], transactions = [];
  for (const { file, bytes } of contents) {
    const calls = encodePublishFile(container, file, bytes);
    if (!seen.has(file.path)) { transactions.push(...calls); continue; }
    const [size, mime, hash, , chunks] = await read('fileInfo', [container, file.path]) as
      readonly [bigint, string, Hex, bigint, bigint];
    if (size < 0n || size > BigInt(bytes.length) || chunks < 1n || chunks > BigInt(calls.length) ||
        size !== BigInt(Math.min(Number(chunks) * 24000, bytes.length)) ||
        mime !== file.contentType || hash.toLowerCase() !== `0x${file.sha256}`)
      throw new Error(`Existing publication cannot be safely resumed: ${file.path}`);
    const parts = [];
    for (let offset = 0; offset < Number(size); offset += 24000) {
      const length = Math.min(24000, Number(size) - offset);
      const hex = await read('readRange', [container, file.path, BigInt(offset), BigInt(length)]) as Hex;
      if (!/^0x(?:[a-f0-9]{2})*$/i.test(hex)) throw new Error('Malformed existing file range');
      const part = Buffer.from(hex.slice(2), 'hex');
      if (part.length !== length) throw new Error('Truncated existing file range');
      parts.push(part);
    }
    if (!Buffer.concat(parts).equals(bytes.subarray(0, Number(size))))
      throw new Error(`Existing bytes differ from release: ${file.path}`);
    transactions.push(...calls.slice(Number(chunks)));
    checked.push({ path: file.path, existingChunks: chunks.toString(), existingBytes: size.toString(),
      complete: size === BigInt(file.size) });
  }
  const fallback = await read('fallbackPath', [container]);
  if (transactions.length || fallback !== 'index.html') transactions.push(fallbackTransaction(container));
  await rpc.assertBlock(block);
  return { schemaVersion: 1, status: 'UNSIGNED_RESUME_PLAN_ONLY', container, block,
    manifestSha256: publication.manifestSha256, checked, transactionCount: transactions.length, transactions,
    scope: 'Exact fixed-block byte prefixes and original chunk boundaries. No writes or blind replay. ' +
      'No ownership, implementation approval, activation, budget or future-state guarantee. ' +
      'Stop if the container changes; recheck and estimate every operation before any wallet confirmation.' };
}
