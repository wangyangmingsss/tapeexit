import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadPublishedReleaseEvidence } from '../tools/published-release-evidence';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, readFile: vi.fn(original.readFile) };
});
it('packages the latest actual publication without approving later builds or signing', async () => {
  const result = await loadPublishedReleaseEvidence();
  expect(result.sourceCommit).toBe('f8771a82c8de048a0ae1d6d41c43d555361dc705');
  expect(result.restrictedWalletTest.remainingWalletConfirmations).toBe(0);
  expect(result.productionSigningApproved).toBe(false);
});
it('rejects altered saved acceptance instead of repackaging an unchecked success', async () => {
  const original = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(readFile).mockImplementationOnce(original.readFile);
  vi.mocked(readFile).mockImplementationOnce(original.readFile);
  vi.mocked(readFile).mockImplementationOnce(async () =>
    Buffer.from('{"status":"PUBLISHED_VAULT_RECOVERY_CHECKED","productionSigningApproved":true}'));
  await expect(loadPublishedReleaseEvidence()).rejects.toThrow('digest differs');
  vi.mocked(readFile).mockImplementation(original.readFile);
});
