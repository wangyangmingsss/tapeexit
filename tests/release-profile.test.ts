import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { digest } from '../tools/publish-core';
import { assertProfileManifest, parseGatewayProfile, parseReleaseProfile, checkGatewayFile,
  parseReviewAttachments, verifyReleaseEvidence, verifyLiveReleaseEvidence, type ReleaseProof,
} from '../tools/release-profile-core';
import { REVIEW_SURFACES } from '../tools/review-handoff-core';
import { WOKB } from '../src/config';

const now = Date.parse('2026-10-28T00:00:00Z');
const identity = { schemaVersion: 1, chainId: 196, sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64),
  container: '0x2000000000000000000000000000000000000002', tapeName: '1.2.344.tape',
  gateways: [{ origin: 'https://1-2-344.primary.example', operator: 'primary' },
    { origin: 'https://1-2-344.backup.example', operator: 'backup' }] };
const assets = [{ address: '0x1000000000000000000000000000000000000001', codeHash: `0x${'c'.repeat(64)}`,
  decimals: 6, reviewSha256: 'd'.repeat(64) },
{ address: '0x1000000000000000000000000000000000000002', codeHash: `0x${'d'.repeat(64)}`,
  decimals: 18, reviewSha256: 'e'.repeat(64) }];
const hash = `0x${'ab'.repeat(32)}` as const, blockHash = `0x${'cd'.repeat(32)}` as const;
const account = '0x3000000000000000000000000000000000000003';
const keys = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' }));
function fixture(change: Record<string, Record<string, unknown>> = {},
  reviewChange: Record<string, unknown> = {}, packetChange: Record<string, unknown> = {}) {
  const packetData = {
    schemaVersion: 1, status: 'AWAITING_INDEPENDENT_REVIEW', chainId: 196,
    sourceCommit: identity.sourceCommit, manifestSha256: identity.manifestSha256,
    sourceArchiveSha256: 'c'.repeat(64), lockfileSha256: 'd'.repeat(64),
    createdAt: new Date(now - 3600_000).toISOString(), requiredSurfaces: REVIEW_SURFACES,
    signingApproved: false, ...packetChange,
  };
  const packet = Buffer.from(JSON.stringify(packetData));
  const report = Buffer.from(JSON.stringify({
    ...packetData, packetSha256: digest(packet), reviewedAt: new Date(now - 1800_000).toISOString(),
    reviewer: { name: 'Synthetic reviewer for unit tests', contact: 'test@example.invalid',
      independent: true, independenceStatement: 'Synthetic declaration for tests only' },
    surfaces: REVIEW_SURFACES.map(id => ({ id, reviewed: true, evidence: 'Synthetic evidence' })),
    findings: [], exclusions: [], decision: 'APPROVE_REVIEWED_SCOPE', ...reviewChange,
  }));
  const signature = sign(null, report, keys.privateKey);
  const attachments = { packet, report, signature, publicKey };
  const extensions = { packet: 'json', report: 'json', signature: 'sig', publicKey: 'pem' };
  const attestation = Object.fromEntries(Object.entries(attachments).map(([kind, bytes]) => [kind,
    { path: `release-artifacts/review-${kind}.${extensions[kind as keyof typeof extensions]}`, sha256: digest(bytes) }]));
  const reports: Record<string, Record<string, unknown>> = {
    publication: { status: 'published-bytes-checked', containerLive: true },
    assets: { status: 'REVIEWED', assets },
    wallet: { status: 'REAL_ORIGIN_ACCEPTED', synthetic: false, origin: identity.gateways[0].origin, chainObserved: 196,
      exit: { account, tokenId: '1', transactionHash: hash } },
    gateways: { status: 'TWO_GATEWAYS_CHECKED', primaryBlockedDuringRecovery: true, blockMechanism: 'HTTPS_CONNECT_PROXY',
      gateways: identity.gateways.map((g, index) => ({ ...g, releaseBytesChecked: true, blockedPrimaryConnections: index })) },
    security: { status: 'REVIEW_COMPLETED', reviewer: 'Synthetic reviewer for unit tests',
      unresolvedCritical: 0, unresolvedHigh: 0, attestation },
  };
  const inputs = Object.fromEntries(Object.entries(reports).map(([kind, report]) => [kind,
    Buffer.from(JSON.stringify({ ...identity, observedAt: new Date(now).toISOString(), ...report, ...change[kind] }))]));
  const evidence = Object.fromEntries(Object.entries(inputs).map(([kind, bytes]) =>
    [kind, { path: `release-artifacts/${kind}.json`, sha256: digest(bytes) }]));
  const proof: ReleaseProof = {
    review: { attachments, trustedReviewerKeySha256: digest(publicKey),
      sourceArchiveSha256: 'c'.repeat(64), lockfileSha256: 'd'.repeat(64) },
    recovery: { state: 'block-state-matched', hash, account, tokenId: '1', identityMatches: true,
      receipt: { hash, blockHash, blockNumber: '16', amount0: '10', amount1: '20',
        state: 'received-checked', safe: true, finalized: true },
      beforeBlock: { number: '0xf', hash: blockHash, timestamp: `0x${((BigInt(now) - 132_000n) / 1000n).toString(16)}` },
      afterBlock: { number: '0x10', hash: blockHash, timestamp: `0x${((BigInt(now) - 120_000n) / 1000n).toString(16)}` },
      balances: assets.map((asset, index) => ({
        address: asset.address as `0x${string}`, symbol: 'SYNTHETIC', decimals: asset.decimals,
        before: '100', after: index ? '120' : '110', delta: index ? '20' : '10',
        receiptAmount: index ? '20' : '10', matches: true,
      })),
      liquidity: { before: '100', removed: '1', expected: '99', after: '99', matches: true },
      owed: { amount0: '0', amount1: '0', cleared: true }, limitations: 'Synthetic corroboration for unit tests',
    },
  };
  return { profile: parseReleaseProfile({ ...identity, assets, evidence }), inputs, proof };
}
describe('formal release evidence binding', () => {
  it('rejects a reviewed-asset declaration that attempts to reintroduce excluded WOKB', () => {
    const { profile } = fixture();
    expect(() => parseReleaseProfile({ ...profile, assets: [
      { ...profile.assets[0], address: WOKB.toLowerCase() },
    ] })).toThrow('WOKB is excluded');
  });
  it('rejects an old internal source commit even if the supplied manifest digest is correct', () => {
    const manifest = { app: 'TapeExit', schemaVersion: 1, chainId: 196, signingApproved: false,
      sourceDirty: false, sourceCommit: identity.sourceCommit };
    const bytes = Buffer.from(JSON.stringify(manifest));
    const profile = { ...parseGatewayProfile(identity), manifestSha256: digest(bytes) };
    expect(() => assertProfileManifest(profile, bytes)).not.toThrow();
    for (const patch of [{ sourceCommit: 'c'.repeat(40) }, { sourceDirty: true }, { chainId: 1 },
      { signingApproved: true }]) {
      const stale = Buffer.from(JSON.stringify({ ...manifest, ...patch }));
      expect(() => assertProfileManifest({ ...profile, manifestSha256: digest(stale) }, stale)).toThrow();
    }
    expect(() => assertProfileManifest({ ...profile, manifestSha256: 'd'.repeat(64) }, bytes)).toThrow();
  });
  it('requires signed raw review and fresh recovery without approving signing or claiming independence', () => {
    const { profile, inputs, proof } = fixture();
    const result = verifyReleaseEvidence(profile, inputs, now, proof);
    expect(result.status).toBe('EVIDENCE_CONSISTENT_REQUIRES_HUMAN_APPROVAL');
    expect(result.signingApproved).toBe(false);
    expect(result.scope).toContain('Does not authenticate reviewer independence');
    expect(result.review.independenceAuthenticated).toBe(false);
    expect(result.recovery.state).toBe('block-state-matched');
  });
  it.each([
    ['publication', { containerLive: false }], ['publication', { manifestSha256: 'e'.repeat(64) }],
    ['publication', { status: 'ISOLATED_FORK_REHEARSAL_PASSED', containerLive: true }],
    ['wallet', { status: 'OBSERVATIONS_ONLY' }], ['wallet', { synthetic: true }],
    ['wallet', { origin: 'http://127.0.0.1:4180' }], ['wallet', { chainObserved: 1 }],
    ['assets', { assets: [] }], ['security', { unresolvedHigh: 1 }],
    ['gateways', { primaryBlockedDuringRecovery: false }], ['gateways', { gateways: [identity.gateways[0]] }],
    ['gateways', { blockMechanism: 'PAGE_ROUTE_ONLY' }],
    ['gateways', { gateways: identity.gateways.map(g => ({ ...g, releaseBytesChecked: true, blockedPrimaryConnections: 0 })) }],
    ['security', { observedAt: new Date(now - 86400_001).toISOString() }],
    ['publication', { observedAt: new Date(now + 60_001).toISOString() }],
  ])('rejects unqualified %s evidence %j', (kind, change) => {
    const { profile, inputs, proof } = fixture({ [kind as string]: change as Record<string, unknown> });
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow();
  });
  it('rejects tampered evidence even when declared acceptance fields are unchanged', () => {
    const { profile, inputs, proof } = fixture();
    inputs.wallet = Buffer.concat([Buffer.from(inputs.wallet), Buffer.from(' ')]);
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('digest mismatch');
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
describe('formal preflight cannot substitute declared review and recovery', () => {
  it('rejects status-only reports and a previously generated verification receipt', () => {
    const { profile, inputs, proof } = fixture();
    expect(() => verifyReleaseEvidence(profile, inputs, now)).toThrow('Signed review');
    const legacy = fixture({ security: { attestation: undefined } });
    expect(() => verifyReleaseEvidence(legacy.profile, legacy.inputs, now, proof)).toThrow();
    proof.review.attachments.report = Buffer.from(JSON.stringify({ status: 'AUTHENTICATED_REVIEW_STATEMENT' }));
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('digest mismatch');
  });
  it('does not trust a key pin read from the supplied report', () => {
    const { profile, inputs, proof } = fixture();
    proof.review.trustedReviewerKeySha256 = 'e'.repeat(64);
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('trusted digest');
  });
  it('rejects a report modified together with every untrusted digest but without a new signature', () => {
    const { profile, inputs, proof } = fixture();
    proof.review.attachments.report = Buffer.concat([Buffer.from(proof.review.attachments.report), Buffer.from(' ')]);
    const security = JSON.parse(inputs.security.toString());
    security.attestation.report.sha256 = digest(proof.review.attachments.report);
    inputs.security = Buffer.from(JSON.stringify(security));
    profile.evidence.security.sha256 = digest(inputs.security);
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('signature');
  });
  it.each([
    { sourceCommit: 'e'.repeat(40) }, { manifestSha256: 'e'.repeat(64) },
    { sourceArchiveSha256: 'e'.repeat(64) }, { lockfileSha256: 'e'.repeat(64) },
  ])('rejects a valid signature over a different candidate %j', change => {
    const { profile, inputs, proof } = fixture({}, {}, change);
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('current source');
  });
  it.each([
    { decision: 'REQUEST_CHANGES' }, { exclusions: ['Asset controls excluded'] },
    { findings: [{ id: 'H1', severity: 'high', status: 'accepted', description: 'Synthetic risk',
      acceptanceReason: 'Accepted risk is not remediation' }] },
  ])('rejects unqualified review decisions even when the summary declares zero high findings %j', change => {
    const { profile, inputs, proof } = fixture({}, change);
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('Qualified signed review');
  });
  it.each([
    { exit: undefined }, { exit: { account, tokenId: '01', transactionHash: hash } },
    { exit: { account, tokenId: '1', transactionHash: `0x${'0'.repeat(64)}` } },
    { exit: { account: '0x0000000000000000000000000000000000000000', tokenId: '1', transactionHash: hash } },
  ])('rejects missing or malformed actual exit hints %j', change => {
    const { profile, inputs, proof } = fixture({ wallet: change });
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow();
  });
  it.each(['pending', 'reverted', 'mismatch', 'finality', 'events', 'hash', 'receipt-hash', 'account', 'tokenId'])(
    'rejects fresh recovery with %s', change => {
      const { profile, inputs, proof } = fixture();
      if (proof.recovery.state !== 'block-state-matched') throw new Error('Invalid synthetic fixture');
      if (change === 'pending') proof.recovery = { state: 'pending' };
      else if (change === 'reverted') proof.recovery = { state: 'reverted' };
      else if (change === 'mismatch') proof.recovery = { ...proof.recovery, state: 'block-state-mismatch' };
      else if (change === 'finality') proof.recovery.receipt.finalized = false;
      else if (change === 'events') proof.recovery.receipt.state = 'included-unverified';
      else if (change === 'hash') proof.recovery = { ...proof.recovery, hash: `0x${'ef'.repeat(32)}` as const };
      else if (change === 'receipt-hash') proof.recovery.receipt.hash = `0x${'ef'.repeat(32)}`;
      else if (change === 'account') proof.recovery = { ...proof.recovery, account: identity.container as `0x${string}` };
      else proof.recovery = { ...proof.recovery, tokenId: '2' };
      expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('Fresh finalized');
    },
  );
  it.each(['../report.json', '/report.json', 'a/../report.json', 'a//report.json'])(
    'rejects unsafe nested review paths %s', path => {
      const { inputs } = fixture();
      const refs = JSON.parse(inputs.security.toString()).attestation;
      refs.report.path = path;
      expect(() => parseReviewAttachments(refs)).toThrow('safe evidence');
    },
  );
  it.each(['missing', 'different', 'precision', 'duplicate', 'mismatch'])(
    'rejects recovery asset policy %s', change => {
      const { profile, inputs, proof } = fixture();
      if (proof.recovery.state !== 'block-state-matched') throw new Error('Invalid synthetic fixture');
      if (change === 'missing') proof.recovery.balances.length = 0;
      if (change === 'different') proof.recovery.balances[0].address = account;
      if (change === 'precision') proof.recovery.balances[0].decimals = 18;
      if (change === 'duplicate') proof.recovery.balances[1] = proof.recovery.balances[0];
      if (change === 'mismatch') proof.recovery.balances[0].matches = false;
      expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('Actual recovery assets');
    },
  );
  it.each([
    ['predates-review', now - 3600_000],
    ['future-block', now + 61_000],
  ] as const)('rejects actual exit chronology %s', (_name, time) => {
    const { profile, inputs, proof } = fixture();
    if (proof.recovery.state !== 'block-state-matched') throw new Error('Invalid synthetic fixture');
    proof.recovery.afterBlock.timestamp = `0x${(BigInt(time) / 1000n).toString(16)}`;
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('must follow');
  });
  it('rejects a wallet observation which predates the actual exit beyond clock tolerance', () => {
    const { profile, inputs, proof } = fixture({
      wallet: { observedAt: new Date(now - 600_000).toISOString() },
    });
    expect(() => verifyReleaseEvidence(profile, inputs, now, proof)).toThrow('must follow');
  });
  it('permits only subsecond block timestamp rounding at the review boundary', () => {
    const { profile, inputs, proof } = fixture({}, { reviewedAt: new Date(now - 119_001).toISOString() });
    expect(verifyReleaseEvidence(profile, inputs, now, proof).signingApproved).toBe(false);
    const tooLate = fixture({}, { reviewedAt: new Date(now - 119_000).toISOString() });
    expect(() => verifyReleaseEvidence(tooLate.profile, tooLate.inputs, now, tooLate.proof)).toThrow('must follow');
  });
});
describe('fresh verification orchestration', () => {
  it('calls the chain inspector with the exact declared exit after signed review checks', async () => {
    const { profile, inputs, proof } = fixture();
    const inspect = vi.fn().mockResolvedValue(proof.recovery);
    const result = await verifyLiveReleaseEvidence(profile, inputs, proof.review, inspect, () => now);
    expect(inspect).toHaveBeenCalledExactlyOnceWith({ account, tokenId: 1n, transactionHash: hash });
    expect(result).toMatchObject({ signingApproved: false, recovery: { state: 'block-state-matched' } });
  });
  it.each(['signature', 'gateway', 'wallet'])('does not query an exit after invalid %s evidence', async kind => {
    const { profile, inputs, proof } = kind === 'gateway'
      ? fixture({ gateways: { primaryBlockedDuringRecovery: false } })
      : kind === 'wallet' ? fixture({ wallet: { synthetic: true } }) : fixture();
    if (kind === 'signature') proof.review.attachments.signature = Buffer.alloc(64);
    const inspect = vi.fn().mockResolvedValue(proof.recovery);
    await expect(verifyLiveReleaseEvidence(profile, inputs, proof.review, inspect, () => now)).rejects.toThrow();
    expect(inspect).not.toHaveBeenCalled();
  });
  it('propagates archive failures without manufacturing a successful recovery', async () => {
    const { profile, inputs, proof } = fixture();
    await expect(verifyLiveReleaseEvidence(profile, inputs, proof.review,
      async () => { throw new Error('Archive unavailable'); }, () => now)).rejects.toThrow('Archive unavailable');
  });
  it('rejects reports which expire during the live lookup', async () => {
    const { profile, inputs, proof } = fixture();
    let time = now;
    await expect(verifyLiveReleaseEvidence(profile, inputs, proof.review, async () => {
      time += 86400_001;
      return proof.recovery;
    }, () => time)).rejects.toThrow('stale');
  });
  it('rejects substituted evidence while live verification is pending', async () => {
    const { profile, inputs, proof } = fixture();
    await expect(verifyLiveReleaseEvidence(profile, inputs, proof.review, async () => {
      inputs.wallet = Buffer.concat([inputs.wallet, Buffer.from(' ')]);
      return proof.recovery;
    }, () => now)).rejects.toThrow('digest mismatch');
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
