import { describe, expect, it } from 'vitest';
import { digest } from '../tools/publish-core';
import { parseGatewayProfile, parseReleaseProfile, checkGatewayFile, verifyReleaseEvidence } from '../tools/release-profile-core';

const now = Date.parse('2026-10-28T00:00:00Z');
const identity = { schemaVersion: 1, chainId: 196, sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64),
  container: '0x2000000000000000000000000000000000000002', tapeName: '1.2.344.tape',
  gateways: [{ origin: 'https://1-2-344.primary.example', operator: 'primary' },
    { origin: 'https://1-2-344.backup.example', operator: 'backup' }] };
const assets = [{ address: '0x1000000000000000000000000000000000000001', codeHash: `0x${'c'.repeat(64)}`,
  decimals: 6, reviewSha256: 'd'.repeat(64) }];
function fixture(change: Record<string, Record<string, unknown>> = {}) {
  const reports: Record<string, Record<string, unknown>> = {
    publication: { status: 'published-bytes-checked', containerLive: true },
    assets: { status: 'REVIEWED', assets },
    wallet: { status: 'REAL_ORIGIN_ACCEPTED', synthetic: false, origin: identity.gateways[0].origin, chainObserved: 196 },
    gateways: { status: 'TWO_GATEWAYS_CHECKED', primaryBlockedDuringRecovery: true,
      gateways: identity.gateways.map(g => ({ ...g, releaseBytesChecked: true })) },
    security: { status: 'REVIEW_COMPLETED', reviewer: 'Synthetic reviewer for unit tests', unresolvedCritical: 0, unresolvedHigh: 0 },
  };
  const inputs = Object.fromEntries(Object.entries(reports).map(([kind, report]) => [kind,
    Buffer.from(JSON.stringify({ ...identity, observedAt: new Date(now).toISOString(), ...report, ...change[kind] }))]));
  const evidence = Object.fromEntries(Object.entries(inputs).map(([kind, bytes]) =>
    [kind, { path: `release-artifacts/${kind}.json`, sha256: digest(bytes) }]));
  return { profile: parseReleaseProfile({ ...identity, assets, evidence }), inputs };
}
describe('formal release evidence binding', () => {
  it('accepts consistent declared evidence without approving signing or authenticating a reviewer', () => {
    const { profile, inputs } = fixture();
    const result = verifyReleaseEvidence(profile, inputs, now);
    expect(result.status).toBe('EVIDENCE_CONSISTENT_REQUIRES_HUMAN_APPROVAL');
    expect(result.signingApproved).toBe(false);
    expect(result.scope).toContain('Does not authenticate reviewer independence');
  });
  it.each([
    ['publication', { containerLive: false }], ['publication', { manifestSha256: 'e'.repeat(64) }],
    ['wallet', { status: 'OBSERVATIONS_ONLY' }], ['wallet', { synthetic: true }],
    ['wallet', { origin: 'http://127.0.0.1:4180' }], ['wallet', { chainObserved: 1 }],
    ['assets', { assets: [] }], ['security', { unresolvedHigh: 1 }],
    ['gateways', { primaryBlockedDuringRecovery: false }], ['gateways', { gateways: [identity.gateways[0]] }],
    ['security', { observedAt: new Date(now - 86400_001).toISOString() }],
    ['publication', { observedAt: new Date(now + 60_001).toISOString() }],
  ])('rejects unqualified %s evidence %j', (kind, change) => {
    const { profile, inputs } = fixture({ [kind as string]: change as Record<string, unknown> });
    expect(() => verifyReleaseEvidence(profile, inputs, now)).toThrow();
  });
  it('rejects tampered evidence even when declared acceptance fields are unchanged', () => {
    const { profile, inputs } = fixture();
    inputs.wallet = Buffer.concat([Buffer.from(inputs.wallet), Buffer.from(' ')]);
    expect(() => verifyReleaseEvidence(profile, inputs, now)).toThrow('digest mismatch');
  });
  it.each([
    { assets: [] }, { assets: [assets[0], assets[0]] },
    { evidence: { publication: { path: '../outside.json', sha256: 'a'.repeat(64) } } },
    { evidence: { publication: { path: '/outside.json', sha256: 'a'.repeat(64) } } },
  ])('rejects incomplete or unsafe release profile %j', patch => {
    const { profile } = fixture();
    expect(() => parseReleaseProfile({ ...profile, ...patch })).toThrow();
  });
});
describe('gateway identity and exact bytes', () => {
  it.each([
    [{ ...identity.gateways[0], origin: 'http://1-2-344.primary.example' }, identity.gateways[1]],
    [identity.gateways[0], identity.gateways[0]],
    [identity.gateways[0], { ...identity.gateways[1], operator: 'primary' }],
    [{ ...identity.gateways[0], origin: 'https://1-2-344.primary.example/extra' }, identity.gateways[1]],
    [{ ...identity.gateways[0], origin: 'https://2-2-344.primary.example' }, identity.gateways[1]],
  ])('rejects invalid origin/operator pairs %j', (a, b) => {
    expect(() => parseGatewayProfile({ ...identity, gateways: [a, b] })).toThrow();
  });
  it('requires exact client headers, content type, origin, size and digest', () => {
    const profile = parseGatewayProfile(identity), bytes = Buffer.from('release');
    const file = { path: 'index.html', size: bytes.length, sha256: digest(bytes), contentType: 'text/html' };
    const origin = identity.gateways[0].origin;
    const headers = { 'x-tape-mode': 'client', 'x-tape-verified': '1', 'x-tape-status': 'ok',
      'x-tape-name': identity.tapeName, 'x-tape-container': identity.container, 'content-type': 'text/html; charset=utf-8' };
    expect(() => checkGatewayFile(profile, file, bytes, headers, origin + '/index.html', origin)).not.toThrow();
    for (const key of Object.keys(headers)) {
      expect(() => checkGatewayFile(profile, file, bytes, { ...headers, [key]: 'wrong' }, origin, origin)).toThrow();
    }
    expect(() => checkGatewayFile(profile, file, Buffer.from('changed'), headers, origin, origin)).toThrow();
    expect(() => checkGatewayFile(profile, file, bytes, headers, identity.gateways[1].origin, origin)).toThrow();
  });
});
