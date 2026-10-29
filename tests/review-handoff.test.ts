import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { digest } from '../tools/publish-core';
import { REVIEW_SURFACES, verifyReviewStatement, type ReviewPacket } from '../tools/review-handoff-core';

const now = Date.parse('2026-10-29T00:00:00Z');
const packet: ReviewPacket = {
  schemaVersion: 1, status: 'AWAITING_INDEPENDENT_REVIEW', chainId: 196,
  sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64), sourceArchiveSha256: 'c'.repeat(64),
  lockfileSha256: 'd'.repeat(64), createdAt: new Date(now - 3600_000).toISOString(),
  requiredSurfaces: REVIEW_SURFACES, signingApproved: false,
};
const keys = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' }));
function fixture(change: Record<string, unknown> = {}, packetChange: Partial<ReviewPacket> = {}) {
  const packetBytes = Buffer.from(JSON.stringify({ ...packet, ...packetChange }));
  const report = {
    schemaVersion: 1, packetSha256: digest(packetBytes), sourceCommit: packet.sourceCommit,
    manifestSha256: packet.manifestSha256, sourceArchiveSha256: packet.sourceArchiveSha256,
    lockfileSha256: packet.lockfileSha256, reviewedAt: new Date(now).toISOString(),
    reviewer: { name: 'Synthetic test reviewer', contact: 'test@example.invalid',
      independent: true, independenceStatement: 'Synthetic declaration for tests only' },
    surfaces: REVIEW_SURFACES.map(id => ({ id, reviewed: true, evidence: 'Synthetic test evidence' })),
    findings: [], exclusions: [], decision: 'APPROVE_REVIEWED_SCOPE', ...change,
  };
  const bytes = Buffer.from(JSON.stringify(report));
  const signature = sign(null, bytes, keys.privateKey);
  return { packetBytes, bytes, signature, check: () =>
    verifyReviewStatement(packetBytes, bytes, signature, publicKey, digest(publicKey), now) };
}
describe('frozen source independent review intake', () => {
  it('authenticates the exact statement without asserting independence or enabling signing', () => {
    const result = fixture().check();
    expect(result).toMatchObject({ status: 'AUTHENTICATED_REVIEW_STATEMENT',
      eligibleForHumanReleaseAssessment: true, independenceAuthenticated: false, signingApproved: false });
    expect(result.reportSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects modified signed bytes, a different signature, key or independently pinned key digest', () => {
    const { packetBytes, bytes, signature } = fixture();
    const check = (data: Uint8Array, sig: Uint8Array, key: Uint8Array, pin: string) =>
      verifyReviewStatement(packetBytes, data, sig, key, pin, now);
    expect(() => check(Buffer.concat([bytes, Buffer.from(' ')]), signature, publicKey, digest(publicKey))).toThrow('signature');
    expect(() => check(bytes, Buffer.alloc(64), publicKey, digest(publicKey))).toThrow('signature');
    expect(() => check(bytes, signature.subarray(1), publicKey, digest(publicKey))).toThrow('signature');
    expect(() => check(bytes, signature, publicKey, 'f'.repeat(64))).toThrow('trusted digest');
    const other = Buffer.from(generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
    expect(() => check(bytes, signature, other, digest(other))).toThrow('signature');
    const privateBytes = Buffer.from(keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    expect(() => check(bytes, signature, privateBytes, digest(privateBytes))).toThrow('public key');
  });
  it.each([
    { sourceCommit: 'e'.repeat(40) }, { manifestSha256: 'e'.repeat(64) },
    { sourceArchiveSha256: 'e'.repeat(64) }, { lockfileSha256: 'e'.repeat(64) },
    { packetSha256: 'e'.repeat(64) }, { reviewer: { name: 'Self review', independent: false } },
    { surfaces: [] }, { findings: null }, { exclusions: null }, { decision: null },
    { surfaces: REVIEW_SURFACES.map(() => ({ id: REVIEW_SURFACES[0], reviewed: true, evidence: 'duplicate' })) },
    { reviewedAt: new Date(now + 60_001).toISOString() },
    { reviewedAt: new Date(now - 3660_001).toISOString() },
  ])('rejects an incomplete, stale-source or wrongly scoped statement %j', change => {
    expect(() => fixture(change).check()).toThrow();
  });
  it.each([
    { signingApproved: true }, { requiredSurfaces: [] }, { sourceCommit: 'invalid' },
    { createdAt: new Date(now + 60_001).toISOString() },
  ])('rejects invalid packet claims even if freshly signed %j', change => {
    expect(() => fixture({}, change as Partial<ReviewPacket>).check()).toThrow();
  });
  it.each(['critical', 'high'])('counts accepted %s findings as unresolved', severity => {
    expect(fixture({ findings: [{ id: 'F1', description: 'test', severity, status: 'accepted',
      acceptanceReason: 'Explicitly accepted but still unresolved' }] }).check()).toMatchObject({
      eligibleForHumanReleaseAssessment: false, [severity === 'critical' ? 'unresolvedCritical' : 'unresolvedHigh']: 1,
    });
  });
  it('preserves request-changes and exclusions without qualifying for assessment', () => {
    expect(fixture({ decision: 'REQUEST_CHANGES' }).check().eligibleForHumanReleaseAssessment).toBe(false);
    expect(fixture({ exclusions: ['Token governance unreviewed'] }).check().eligibleForHumanReleaseAssessment).toBe(false);
  });
  it('requires remediation evidence and unique finding identifiers', () => {
    const finding = { id: 'F1', description: 'test', severity: 'high', status: 'resolved' };
    expect(() => fixture({ findings: [finding] }).check()).toThrow('retest');
    expect(fixture({ findings: [{ ...finding, retestEvidence: 'Reviewed exact-source retest' }] })
      .check().eligibleForHumanReleaseAssessment).toBe(true);
    expect(() => fixture({ findings: [finding, finding] }).check()).toThrow();
  });
});
