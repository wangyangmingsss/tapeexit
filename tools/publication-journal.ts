import { mkdir, open, readFile, rename, rm, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { UploadJournal } from './publication-workbench-core';

export async function openPublicationJournal(pathInput: string, contextId: string) {
  const path = resolve(pathInput), directory = dirname(path), lock = `${path}.lock`;
  await mkdir(directory, { recursive: true });
  // An existing lock is never reclaimed automatically, including after a crash.
  await mkdir(lock);
  let closed = false;
  async function save(journal: UploadJournal) {
    if (closed || journal.contextId !== contextId) throw new Error('Journal is closed or context changed');
    const bytes = Buffer.from(JSON.stringify(journal, null, 2) + '\n');
    if (bytes.length > 2 * 1024 * 1024) throw new Error('Upload journal exceeds size limit');
    const temporary = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    try {
      await rename(temporary, path);
      const dir = await open(directory, 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    } finally { await rm(temporary, { force: true }); }
  }
  async function close() {
    if (closed) return;
    closed = true;
    await rm(lock, { recursive: true });
  }
  try {
    let journal: UploadJournal;
    const stat = await lstat(path).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat) {
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Invalid upload journal file');
      journal = JSON.parse(await readFile(path, 'utf8'));
      if (journal.contextId !== contextId) throw new Error('Journal belongs to another release/profile');
    } else {
      journal = { schemaVersion: 1, contextId, authorization: null, attempts: [] };
      await save(journal);
    }
    return { journal, save, close };
  } catch (error) { await close(); throw error; }
}
