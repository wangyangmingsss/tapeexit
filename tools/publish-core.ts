import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encodeFunctionData, getAddress, parseAbi, zeroAddress, type Address, type Hex } from 'viem';

export const REGISTRY = getAddress('0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6');
export const BINDING = getAddress('0x68809fd2fb343aa57d0aeb7f33defe477c9666f9');
export const MAX_FILE_BYTES = 8_400_000;
export const publishAbi = parseAbi([
  'function putFile(address container,string path,string contentType,bytes32 sha256Hash,bytes data)',
  'function appendChunk(address container,string path,uint256 expectIndex,bytes data)',
  'function setFallback(address container,string path)',
  'function removeFile(address container,string path)',
]);
export interface PublishFile { path: string; contentType: string; size: number; sha256: string }
export interface PublishTransaction { file: string; chunk: number; to: Address; value: '0'; data: Hex }
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function validatePublishManifest(value: unknown): PublishFile[] {
  const m = value as Record<string, unknown> | null;
  if (!m || m.app !== 'TapeExit' || m.schemaVersion !== 1 || m.chainId !== 196 ||
      m.signingApproved !== false || m.sourceDirty !== false ||
      typeof m.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(m.sourceCommit) ||
      !Array.isArray(m.files) || !m.files.length || m.files.length > 1000)
    throw new Error('Unexpected or uncommitted release manifest');
  const seen = new Set(['release-manifest.json']);
  return m.files.map((file: unknown) => {
    const f = file as PublishFile | null;
    if (!f || typeof f.path !== 'string' || !/^[\w./-]+$/.test(f.path) ||
        f.path.split('/').some(part => !part || part === '.' || part === '..') ||
        f.path === 'sw.js' || f.path === '.tape' || f.path.startsWith('.tape/') ||
        seen.has(f.path) || typeof f.contentType !== 'string' ||
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:; charset=utf-8)?$/i.test(f.contentType) ||
        !Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_FILE_BYTES ||
        typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256))
      throw new Error('Unsafe publish file declaration');
    seen.add(f.path);
    return { path: f.path, contentType: f.contentType, size: f.size, sha256: f.sha256 };
  });
}
export function encodePublishFile(container: Address, file: PublishFile, bytes: Uint8Array): PublishTransaction[] {
  if (getAddress(container) === zeroAddress) throw new Error('Zero container');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('File exceeds registry capacity');
  if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error(`File mismatch: ${file.path}`);
  const transactions: PublishTransaction[] = [];
  for (let offset = 0, chunk = 0; offset < bytes.length || offset === 0; offset += 24000, chunk++) {
    const data = `0x${Buffer.from(bytes.subarray(offset, offset + 24000)).toString('hex')}` as Hex;
    transactions.push({ file: file.path, chunk, to: REGISTRY, value: '0',
      data: chunk === 0 ? encodeFunctionData({ abi: publishAbi, functionName: 'putFile',
        args: [container, file.path, file.contentType, `0x${file.sha256}`, data] }) :
        encodeFunctionData({ abi: publishAbi, functionName: 'appendChunk',
          args: [container, file.path, BigInt(chunk), data] }) });
  }
  return transactions;
}
export function fallbackTransaction(container: Address): PublishTransaction {
  return { file: '(fallback)', chunk: 0, to: REGISTRY, value: '0',
    data: encodeFunctionData({ abi: publishAbi, functionName: 'setFallback', args: [container, 'index.html'] }) };
}
export async function loadPublication(directory: string) {
  const root = await realpath(directory);
  const manifestBytes = await readFile(resolve(root, 'release-manifest.json'));
  const files = validatePublishManifest(JSON.parse(manifestBytes.toString()));
  if (!files.some(file => file.path === 'index.html')) throw new Error('Missing index.html');
  const declared = new Set([...files.map(file => file.path), 'release-manifest.json']);
  async function inspect(dir: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) await inspect(resolve(dir, entry.name), path + '/');
      else if (!entry.isFile() || !declared.has(path)) throw new Error(`Undeclared file or link: ${path}`);
    }
  }
  await inspect(root);
  const fileList = [...files, { path: 'release-manifest.json', contentType: 'application/json',
    size: manifestBytes.length, sha256: digest(manifestBytes) }]
    .sort((a, b) => Number(a.path === 'index.html') - Number(b.path === 'index.html'));
  const contents: { file: PublishFile; bytes: Buffer }[] = [];
  for (const file of fileList) {
    const bytes = await readFile(resolve(root, file.path));
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new Error(`File mismatch: ${file.path}`);
    contents.push({ file, bytes });
  }
  return { manifestSha256: digest(manifestBytes), contents };
}
export async function preparePublication(directory: string, container: Address) {
  const { manifestSha256, contents } = await loadPublication(directory);
  const transactions = contents.flatMap(({ file, bytes }) => encodePublishFile(container, file, bytes));
  transactions.push(fallbackTransaction(container));
  return { manifestSha256, transactions };
}
