import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPublicationJournal } from '../tools/publication-journal';

describe('durable publication journal', () => {
  it('persists consent, serializes instances and reopens the same context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tapeexit-journal-')), path = join(dir, 'journal.json');
    try {
      const store = await openPublicationJournal(path, 'a'.repeat(64));
      await expect(openPublicationJournal(path, 'a'.repeat(64))).rejects.toThrow();
      store.journal.authorization = { grantedAt: 10, expiresAt: 100, maximumWei: '1000' };
      await store.save(store.journal);
      expect(JSON.parse(await readFile(path, 'utf8')).authorization.maximumWei).toBe('1000');
      await store.close();
      await expect(store.save(store.journal)).rejects.toThrow('closed');
      const reopened = await openPublicationJournal(path, 'a'.repeat(64));
      expect(reopened.journal.authorization?.expiresAt).toBe(100);
      await reopened.close();
      await expect(openPublicationJournal(path, 'b'.repeat(64))).rejects.toThrow('another release');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects malformed JSON and symlinks while releasing its own lock after failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tapeexit-journal-')), path = join(dir, 'journal.json');
    try {
      await writeFile(path, '{broken');
      await expect(openPublicationJournal(path, 'a'.repeat(64))).rejects.toThrow();
      await rm(path); await symlink('/etc/hosts', path);
      await expect(openPublicationJournal(path, 'a'.repeat(64))).rejects.toThrow('Invalid');
      await rm(path);
      const store = await openPublicationJournal(path, 'a'.repeat(64));
      await store.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
