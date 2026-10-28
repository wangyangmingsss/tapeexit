import { expect, it } from 'vitest';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
// @ts-expect-error Node reporting tool
import { summarizePilots, verifyPilotFiles } from '../tools/pilot-validation.mjs';
const now = Date.parse('2026-10-28T00:00:00Z');
const ref = { path: 'evidence/interview.txt', sha256: 'e'.repeat(64) };
const base = { pilotId: 'fixture-pilot', organizationId: 'fixture-org', consentToRecord: true,
  observedAt: new Date(now).toISOString(), sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64),
  environment: 'local-fork', stage: 'INTERVIEWED', evidence: { interview: ref }, receivedUsdCents: null };
it('reports no pilot evidence without inputs', () => {
  expect(summarizePilots([], now)).toMatchObject({ status: 'NO_PILOT_EVIDENCE', pilotCount: 0,
    organizationCount: 0, groups: [] });
});
it('separates release and environment claims without copying private identities', () => {
  const report = summarizePilots([base, { ...base, pilotId: 'other', environment: 'mainnet' },
    { ...base, pilotId: 'new-version', sourceCommit: 'c'.repeat(40) }], now);
  expect(report.organizationCount).toBe(1);
  expect(report.pilotCount).toBe(3);
  expect(report.groups).toHaveLength(3);
  expect(JSON.stringify(report)).not.toContain('fixture-org');
  expect(JSON.stringify(report)).not.toContain(ref.path);
  expect(report.status).toBe('RECORDED_CLAIMS_REQUIRE_HUMAN_VERIFICATION');
});
it('requires each earlier evidence category and separates positive declared receipts from costs', () => {
  const evidence = Object.fromEntries(['interview', 'agreement', 'outcome', 'payment'].map(key => [key, ref]));
  const report = summarizePilots([{ ...base, stage: 'PAID', evidence, receivedUsdCents: 12345 }], now);
  expect(report.groups[0].declaredReceivedUsdCents).toBe('12345');
  expect(report.groups[0].stages).toEqual({ INTERVIEWED: 0, AGREED: 0, COMPLETED: 0, PAID: 1 });
  expect(() => summarizePilots([{ ...base, stage: 'PAID', evidence: { payment: ref },
    receivedUsdCents: 12345 }], now)).toThrow('evidence');
});
it.each([
  { consentToRecord: false }, { stage: 'CUSTOMER' }, { stage: 'AGREED' }, { receivedUsdCents: 0 },
  { environment: 'real' }, { observedAt: new Date(now + 1).toISOString() }, { observedAt: null },
  { evidence: { interview: { ...ref, path: '../private.txt' } } },
  { evidence: { interview: { ...ref, path: '/private.txt' } } },
  { evidence: { interview: { ...ref, sha256: '0'.repeat(64) } } },
  { evidence: { interview: { ...ref, contents: 'not allowed' } } }, { contact: 'private-person' },
])('rejects incomplete or unsafe claims %j', patch => {
  expect(() => summarizePilots([{ ...base, ...patch }], now)).toThrow();
});
it('rejects duplicate pilot records rather than counting stages twice', () => {
  expect(() => summarizePilots([base, base], now)).toThrow();
});
it('checks evidence bytes and rejects a symlink outside the private directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tapeexit-pilot-'));
  try {
    await mkdir(join(root, 'private')); await writeFile(join(root, 'record.txt'), 'observed fixture');
    await symlink(join(root, 'record.txt'), join(root, 'private', 'escape.txt'));
    const sha256 = createHash('sha256').update('observed fixture').digest('hex');
    const records = [{ ...base, evidence: { interview: { path: 'record.txt', sha256 } } }];
    await expect(verifyPilotFiles(records, root)).resolves.toBeUndefined();
    await expect(verifyPilotFiles([{ ...base, evidence: { interview: { path: 'escape.txt', sha256 } } }],
      join(root, 'private'))).rejects.toThrow('escapes');
    await writeFile(join(root, 'record.txt'), 'changed');
    await expect(verifyPilotFiles(records, root)).rejects.toThrow('changed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
