import { createPublicKey, verify } from 'node:crypto';
import { digest } from './publish-core';

export const REVIEW_SURFACES = [
  'deployment-assets-governance', 'integer-math-calldata', 'wallet-boundary',
  'receipt-finality-recovery', 'submission-locks', 'publication-resume',
  'entrypoint-local-gateway', 'build-dependencies',
] as const;

export interface ReviewPacket {
  schemaVersion: 1; status: 'AWAITING_INDEPENDENT_REVIEW'; chainId: 196;
  sourceCommit: string; manifestSha256: string; sourceArchiveSha256: string;
  lockfileSha256: string; createdAt: string; requiredSurfaces: readonly string[];
  signingApproved: false;
}

const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0{64}$/.test(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 4096;

export function validateReviewPacket(value: unknown): asserts value is ReviewPacket {
  const p = value as ReviewPacket;
  if (!p || p.schemaVersion !== 1 || p.status !== 'AWAITING_INDEPENDENT_REVIEW' ||
      p.chainId !== 196 || !/^[a-f0-9]{40}$/.test(p.sourceCommit) ||
      !sha(p.manifestSha256) || !sha(p.sourceArchiveSha256) || !sha(p.lockfileSha256) ||
      !Number.isFinite(Date.parse(p.createdAt)) || p.signingApproved !== false ||
      JSON.stringify(p.requiredSurfaces) !== JSON.stringify(REVIEW_SURFACES))
    throw new Error('Invalid frozen review packet');
}

/** The caller must obtain the public-key digest through a separately trusted channel. */
export function verifyReviewStatement(packetBytes: Uint8Array, reportBytes: Uint8Array,
  signature: Uint8Array, publicKeyBytes: Uint8Array, trustedKeySha256: string, now = Date.now()) {
  if (!sha(trustedKeySha256) || digest(publicKeyBytes) !== trustedKeySha256)
    throw new Error('Reviewer public key differs from the separately trusted digest');
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(
    Buffer.from(publicKeyBytes).toString('utf8')))
    throw new Error('A PEM public key is required; do not supply private keys');
  const key = createPublicKey(Buffer.from(publicKeyBytes));
  if (key.asymmetricKeyType !== 'ed25519' || signature.length !== 64 ||
      !verify(null, reportBytes, key, signature))
    throw new Error('Invalid Ed25519 review signature');
  const packet = JSON.parse(Buffer.from(packetBytes).toString('utf8'));
  validateReviewPacket(packet);
  const r = JSON.parse(Buffer.from(reportBytes).toString('utf8'));
  if (!r || r.schemaVersion !== 1 || r.packetSha256 !== digest(packetBytes) ||
      r.sourceCommit !== packet.sourceCommit || r.manifestSha256 !== packet.manifestSha256 ||
      r.sourceArchiveSha256 !== packet.sourceArchiveSha256 || r.lockfileSha256 !== packet.lockfileSha256)
    throw new Error('Review statement belongs to another packet or source');
  const reviewedAt = Date.parse(r.reviewedAt);
  if (!Number.isFinite(reviewedAt) || reviewedAt < Date.parse(packet.createdAt) - 60_000 ||
      reviewedAt > now + 60_000 || Date.parse(packet.createdAt) > now + 60_000)
    throw new Error('Invalid review time');
  if (!text(r.reviewer?.name) || !text(r.reviewer?.contact) ||
      r.reviewer?.independent !== true || !text(r.reviewer?.independenceStatement))
    throw new Error('Reviewer identity and explicit independence declaration required');
  if (!Array.isArray(r.surfaces) || r.surfaces.length !== REVIEW_SURFACES.length ||
      new Set(r.surfaces.map((s: any) => s?.id)).size !== REVIEW_SURFACES.length ||
      !REVIEW_SURFACES.every(id => r.surfaces.some((s: any) =>
        s?.id === id && s?.reviewed === true && text(s?.evidence))))
    throw new Error('Every required surface must have review evidence');
  if (!Array.isArray(r.findings) || r.findings.length > 1000 ||
      !Array.isArray(r.exclusions) || r.exclusions.length > 100 ||
      r.exclusions.some((item: unknown) => !text(item)) ||
      !['APPROVE_REVIEWED_SCOPE', 'REQUEST_CHANGES'].includes(r.decision))
    throw new Error('Explicit findings, exclusions and decision required');
  const ids = new Set<string>();
  let unresolvedCritical = 0, unresolvedHigh = 0;
  for (const finding of r.findings) {
    if (!finding || !text(finding.id) || ids.has(finding.id) || !text(finding.description) ||
        !['critical', 'high', 'medium', 'low', 'informational'].includes(finding.severity) ||
        !['open', 'resolved', 'accepted'].includes(finding.status) ||
        (finding.status === 'resolved' && !text(finding.retestEvidence)) ||
        (finding.status === 'accepted' && !text(finding.acceptanceReason)))
      throw new Error('Invalid finding or missing remediation/retest evidence');
    ids.add(finding.id);
    if (finding.status !== 'resolved' && finding.severity === 'critical') unresolvedCritical++;
    if (finding.status !== 'resolved' && finding.severity === 'high') unresolvedHigh++;
  }
  const qualified = r.decision === 'APPROVE_REVIEWED_SCOPE' && !r.exclusions.length &&
    unresolvedCritical === 0 && unresolvedHigh === 0;
  return {
    schemaVersion: 1, status: 'AUTHENTICATED_REVIEW_STATEMENT',
    sourceCommit: packet.sourceCommit, manifestSha256: packet.manifestSha256,
    packetSha256: digest(packetBytes), reportSha256: digest(reportBytes),
    publicKeySha256: trustedKeySha256, signatureSha256: digest(signature),
    reviewer: r.reviewer, reviewedAt: r.reviewedAt, observedAt: new Date(now).toISOString(),
    decision: r.decision, unresolvedCritical, unresolvedHigh,
    eligibleForHumanReleaseAssessment: qualified, signingApproved: false,
    independenceAuthenticated: false,
    limitations: 'Authenticates exact signed bytes against a caller-pinned Ed25519 key and frozen scope. ' +
      'Reviewer identity, independence, competence and truth of findings still require human verification. ' +
      'Does not approve assets, publish a release, prove wallet acceptance or enable production signing.',
  } as const;
}
