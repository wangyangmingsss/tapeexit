import { decodeFunctionResult, encodeFunctionData, type Hex, type Address } from 'viem';
import { REGISTRY, digest, encodePublishFile, fallbackTransaction, loadPublication, publishAbi,
  type PublishTransaction } from './publish-core';
import { registryReadAbi } from './verify-publication-core';
import type { StrictRpc } from '../src/core/rpc';

type Publication = Awaited<ReturnType<typeof loadPublication>>;
export function updateRemovals(container: Address, next: Publication, previous: Publication): PublishTransaction[] {
  // Preserve historical operation indices so existing wallet journals remain valid.
  return previous.contents.filter(old => !next.contents.some(item => item.file.path === old.file.path &&
    item.file.sha256 === old.file.sha256 && item.file.size === old.file.size &&
    item.file.contentType === old.file.contentType)).map(old => ({
    file: old.file.path, chunk: -1, to: REGISTRY, value: '0',
    data: encodeFunctionData({ abi: publishAbi, functionName: 'removeFile', args: [container, old.file.path] }),
  }));
}
export function incrementalUpdateOperations(container: Address, next: Publication, previous: Publication,
  includeFallback = true): PublishTransaction[] {
  const obsolete = updateRemovals(container, next, previous)
    .filter(op => !next.contents.some(item => item.file.path === op.file));
  const changed = next.contents.filter(item => !previous.contents.some(old =>
    old.file.path === item.file.path && old.file.sha256 === item.file.sha256 &&
    old.file.size === item.file.size && old.file.contentType === item.file.contentType));
  return [...obsolete, ...changed.flatMap(item => encodePublishFile(container, item.file, item.bytes)),
    ...(includeFallback ? [fallbackTransaction(container)] : [])];
}
// Explicit opt-in migration. Only exact old bytes or exact prefixes of the new release are accepted.
export async function resumePublicationUpdate(rpc: StrictRpc, container: Address, next: Publication,
  previous: Publication, expectedPreviousDigest: string) {
  if (previous.manifestSha256 !== expectedPreviousDigest || !/^[a-f0-9]{64}$/.test(expectedPreviousDigest))
    throw new Error('Trusted previous publication digest mismatch');
  for (const publication of [previous, next])
    if (!publication.contents.length || publication.contents.length > 1001 ||
        publication.contents.reduce((sum, c) => sum + c.bytes.length, 0) > 64 * 1024 * 1024 ||
        publication.contents.some(c => c.bytes.length !== c.file.size || digest(c.bytes) !== c.file.sha256) ||
        !publication.contents.some(c => c.file.path === 'release-manifest.json' && digest(c.bytes) === publication.manifestSha256))
      throw new Error('Invalid migration publication bytes');
  await rpc.checkChain(196);
  const block = await rpc.pin();
  async function read(name: 'pathCount' | 'pathsRange' | 'fileInfo' | 'readRange' | 'fallbackPath',
    args: readonly unknown[]) {
    const result = await rpc.request<Hex>('eth_call', [{ to: REGISTRY,
      data: encodeFunctionData({ abi: registryReadAbi, functionName: name, args } as any) }, block.number]);
    return decodeFunctionResult({ abi: registryReadAbi, functionName: name, data: result });
  }
  const count = await read('pathCount', [container]) as bigint;
  if (count > BigInt(previous.contents.length + next.contents.length)) throw new Error('Unexpected migration paths');
  const paths: string[] = [];
  for (let offset = 0n; offset < count; offset += 200n) {
    const length = count - offset > 200n ? 200n : count - offset;
    const page = await read('pathsRange', [container, offset, length]) as readonly string[];
    if (page.length !== Number(length)) throw new Error('Incomplete migration path enumeration');
    paths.push(...page);
  }
  if (new Set(paths).size !== paths.length) throw new Error('Duplicate migration paths');
  const removals = updateRemovals(container, next, previous), transactions: PublishTransaction[] = [];
  const freshChunks = new Map<string, number>();
  const checked: { path: string; existingChunks: string; existingBytes: string; complete: boolean }[] = [];
  for (const path of paths) {
    const old = previous.contents.find(c => c.file.path === path), fresh = next.contents.find(c => c.file.path === path);
    if (!old && !fresh) throw new Error(`Unknown migration path: ${path}`);
    const [size, mime, hash, , chunks] = await read('fileInfo', [container, path]) as readonly [bigint, string, Hex, bigint, bigint];
    const matches = (item: typeof old, partial: boolean) => item && mime === item.file.contentType &&
      hash.toLowerCase() === `0x${item.file.sha256}` && size >= 0n && size <= BigInt(item.file.size) &&
      chunks >= 1n && chunks <= BigInt(Math.max(1, Math.ceil(item.file.size / 24000))) &&
      size === BigInt(Math.min(Number(chunks) * 24000, item.file.size)) &&
      (partial || size === BigInt(item.file.size));
    const isNew = matches(fresh, true), isOld = matches(old, false);
    const item = isNew ? fresh! : isOld ? old! : null;
    if (!item) throw new Error(`Unrecognized migration metadata: ${path}`);
    const parts: Buffer[] = [];
    for (let offset = 0; offset < Number(size); offset += 24000) {
      const length = Math.min(24000, Number(size) - offset);
      const hex = await read('readRange', [container, path, BigInt(offset), BigInt(length)]) as Hex;
      if (!/^0x(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('Invalid migration file bytes');
      const part = Buffer.from(hex.slice(2), 'hex');
      if (part.length !== length) throw new Error('Truncated migration file');
      parts.push(part);
    }
    if (!Buffer.concat(parts).equals(item.bytes.subarray(0, Number(size))))
      throw new Error(`Migration file bytes differ: ${path}`);
    if (isNew) {
      freshChunks.set(path, Number(chunks));
      checked.push({ path, existingChunks: chunks.toString(), existingBytes: size.toString(),
        complete: size === BigInt(fresh!.file.size) });
    } else if (!fresh) {
      const operation = removals.find(op => op.file === path);
      if (!operation) throw new Error('Unplanned migration removal');
      transactions.push(operation);
    }
  }
  // A same-path putFile replaces the old bytes itself. Only obsolete paths need a removal.
  for (const { file, bytes } of next.contents)
    transactions.push(...encodePublishFile(container, file, bytes).slice(freshChunks.get(file.path) ?? 0));
  const fallback = await read('fallbackPath', [container]);
  if (fallback !== 'index.html') transactions.push(fallbackTransaction(container));
  await rpc.assertBlock(block);
  return { schemaVersion: 1, status: 'UNSIGNED_INCREMENTAL_UPDATE_PLAN',
    container, block, manifestSha256: next.manifestSha256, previousManifestSha256: expectedPreviousDigest,
    checked, transactionCount: transactions.length, transactions,
    scope: 'Exact fixed-block old bytes or new prefixes are checked before every continuation. ' +
      'Only obsolete paths are removed; same-path files are replaced directly. Matching files and fallback are reused. ' +
      'The site may be unavailable during migration. No transaction sent.' };
}
