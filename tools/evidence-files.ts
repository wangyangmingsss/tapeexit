import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { digest } from './publish-core';
import { parseEvidenceReference, type EvidenceReference } from './release-profile-core';

export async function readBoundedFile(path: string, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 * 1024 * 1024)
    throw new Error('Invalid evidence size limit');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error('Evidence must be a bounded regular file');
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error('Evidence grew beyond size limit');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

export async function readProjectEvidence(root: string, input: EvidenceReference, limit = 2_000_000) {
  const ref = parseEvidenceReference(input, '');
  const directory = await realpath(root), file = await realpath(resolve(directory, ref.path));
  if (!file.startsWith(directory + sep)) throw new Error('Evidence symlink escapes project');
  const bytes = await readBoundedFile(file, limit);
  if (digest(bytes) !== ref.sha256) throw new Error('Evidence file digest mismatch');
  return bytes;
}
