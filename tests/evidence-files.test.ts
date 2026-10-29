import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { readBoundedFile, readProjectEvidence } from '../tools/evidence-files';
import { digest } from '../tools/publish-core';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function context() {
  const directory = await mkdtemp(join(tmpdir(), 'tapeexit-evidence-'));
  directories.push(directory);
  const root = join(directory, 'project');
  await mkdir(root);
  const bytes = Buffer.from('{"synthetic":true}\n');
  await writeFile(join(root, 'report.json'), bytes);
  return { directory, root, bytes, ref: { path: 'report.json', sha256: digest(bytes) } };
}
it('loads a digest-bound project artifact within the declared byte limit', async () => {
  const { root, bytes, ref } = await context();
  expect(await readProjectEvidence(root, ref, bytes.length)).toEqual(bytes);
});
it('rejects a digest mismatch and an oversized regular file', async () => {
  const { root, ref, bytes } = await context();
  await expect(readProjectEvidence(root, { ...ref, sha256: 'a'.repeat(64) })).rejects.toThrow('digest mismatch');
  await expect(readProjectEvidence(root, ref, bytes.length - 1)).rejects.toThrow('bounded regular file');
});
it('rejects traversal, absolute paths and symlinks outside the project', async () => {
  const { directory, root, bytes, ref } = await context();
  const outside = join(directory, 'outside.json');
  await writeFile(outside, bytes);
  await symlink(outside, join(root, 'escape.json'));
  for (const path of ['../outside.json', outside])
    await expect(readProjectEvidence(root, { ...ref, path })).rejects.toThrow('safe evidence');
  await expect(readProjectEvidence(root, { ...ref, path: 'escape.json' })).rejects.toThrow('escapes project');
});
it('refuses direct symlink and directory reads', async () => {
  const { root } = await context();
  await symlink(join(root, 'report.json'), join(root, 'link.json'));
  await expect(readBoundedFile(join(root, 'link.json'), 64)).rejects.toThrow();
  await expect(readBoundedFile(root, 64)).rejects.toThrow('bounded regular file');
});
it.each([0, -1, 1.5, Infinity, 33 * 1024 * 1024])('rejects invalid read budget %s', async limit => {
  const { root } = await context();
  await expect(readBoundedFile(join(root, 'report.json'), limit)).rejects.toThrow('size limit');
});
