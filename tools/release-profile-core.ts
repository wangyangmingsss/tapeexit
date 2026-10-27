import { getAddress, zeroAddress } from 'viem';
import { digest, type PublishFile } from './publish-core';

export interface ReleaseProfile {
  schemaVersion: 1; chainId: 196; sourceCommit: string; manifestSha256: string;
  container: string; tapeName: string;
  gateways: { origin: string; operator: string }[];
  assets: { address: string; codeHash: string; decimals: number; reviewSha256: string }[];
  evidence: Record<'publication' | 'assets' | 'wallet' | 'gateways' | 'security', { path: string; sha256: string }>;
}
const sha = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s) && !/^0{64}$/.test(s);
function object(v: unknown): Record<string, any> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected profile object');
  return v as Record<string, any>;
}
function address(v: unknown) {
  if (typeof v !== 'string' || getAddress(v) === zeroAddress) throw new Error('Expected nonzero address');
  return getAddress(v);
}
export type GatewayProfile = Pick<ReleaseProfile, 'schemaVersion' | 'chainId' | 'sourceCommit' |
  'manifestSha256' | 'container' | 'tapeName' | 'gateways'>;
export function assertProfileManifest(profile: GatewayProfile, bytes: Uint8Array) {
  const manifest = object(JSON.parse(Buffer.from(bytes).toString('utf8')));
  if (digest(bytes) !== profile.manifestSha256 || manifest.sourceCommit !== profile.sourceCommit ||
      manifest.sourceDirty !== false || manifest.app !== 'TapeExit' || manifest.schemaVersion !== 1 ||
      manifest.chainId !== 196 || manifest.signingApproved !== false)
    throw new Error('Profile and internal manifest source identity differ');
}
export function parseGatewayProfile(input: unknown): GatewayProfile {
  const p = object(input);
  if (p.schemaVersion !== 1 || p.chainId !== 196 || !/^[a-f0-9]{40}$/.test(p.sourceCommit) ||
      !sha(p.manifestSha256) || !/^(0|[1-9][0-9]*)\.2\.(0|[1-9][0-9]*)\.tape$/.test(p.tapeName))
    throw new Error('Missing X Layer release identity');
  const container = address(p.container);
  if (!Array.isArray(p.gateways) || p.gateways.length !== 2) throw new Error('Two gateway origins required');
  const [id, , cpu] = p.tapeName.split('.');
  const gateways = p.gateways.map((entry: unknown) => {
    const g = object(entry), url = new URL(g.origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' ||
        url.search || url.hash || url.origin !== g.origin || !url.hostname.startsWith(`${id}-2-${cpu}.`) ||
        url.hostname.endsWith('.localhost') || !/^[a-z][a-z0-9-]{1,63}$/.test(g.operator))
      throw new Error('Expected canonical public HTTPS TapeOut site origin and operator');
    return { origin: url.origin, operator: g.operator as string };
  });
  if (gateways[0].origin === gateways[1].origin || gateways[0].operator === gateways[1].operator)
    throw new Error('Separate gateway origins and operators required');
  return { schemaVersion: 1, chainId: 196, sourceCommit: p.sourceCommit, manifestSha256: p.manifestSha256,
    container, tapeName: p.tapeName, gateways };
}
export function parseReleaseProfile(input: unknown): ReleaseProfile {
  const identity = parseGatewayProfile(input), p = object(input);
  if (!Array.isArray(p.assets) || !p.assets.length || p.assets.length > 20) throw new Error('Reviewed assets required');
  const assets = p.assets.map((input: unknown) => {
    const a = object(input);
    if (!/^0x[a-f0-9]{64}$/.test(a.codeHash) || /^0x0{64}$/.test(a.codeHash) || !sha(a.reviewSha256) ||
        !Number.isInteger(a.decimals) || a.decimals < 0 || a.decimals > 36) throw new Error('Invalid reviewed asset');
    return { address: address(a.address), codeHash: a.codeHash, decimals: a.decimals, reviewSha256: a.reviewSha256 };
  });
  if (new Set(assets.map(a => a.address)).size !== assets.length) throw new Error('Duplicate reviewed asset');
  const evidence = {} as ReleaseProfile['evidence'];
  for (const kind of ['publication', 'assets', 'wallet', 'gateways', 'security'] as const) {
    const e = object(object(p.evidence)[kind]);
    if (typeof e.path !== 'string' || !/^[a-zA-Z0-9_./-]+\.json$/.test(e.path) || e.path.startsWith('/') ||
        e.path.split('/').some((part: string) => !part || part === '.' || part === '..') || !sha(e.sha256))
      throw new Error(`Missing safe ${kind} evidence path or digest`);
    evidence[kind] = { path: e.path, sha256: e.sha256 };
  }
  return { ...identity, assets, evidence };
}
export function checkGatewayFile(profile: GatewayProfile, file: PublishFile, bytes: Uint8Array,
  headers: Record<string, string>, finalUrl: string, origin: string) {
  if (new URL(finalUrl).origin !== origin || bytes.length !== file.size || digest(bytes) !== file.sha256 ||
      headers['x-tape-mode'] !== 'client' || headers['x-tape-verified'] !== '1' ||
      headers['x-tape-status'] !== 'ok' || headers['x-tape-name'] !== profile.tapeName ||
      headers['x-tape-container']?.toLowerCase() !== profile.container.toLowerCase() ||
      headers['content-type']?.split(';')[0] !== file.contentType.split(';')[0])
    throw new Error(`Gateway identity or release bytes mismatch: ${file.path}`);
}
export function verifyReleaseEvidence(profile: ReleaseProfile, inputs: Record<string, Uint8Array>, now = Date.now()) {
  const reports: Record<string, any> = {};
  for (const [kind, ref] of Object.entries(profile.evidence)) {
    const bytes = inputs[kind];
    if (!bytes || digest(bytes) !== ref.sha256) throw new Error(`${kind} evidence digest mismatch`);
    const e = object(JSON.parse(Buffer.from(bytes).toString('utf8')));
    if (e.sourceCommit !== profile.sourceCommit || e.manifestSha256 !== profile.manifestSha256 ||
        e.container?.toLowerCase() !== profile.container.toLowerCase() || e.chainId !== 196)
      throw new Error(`${kind} evidence belongs to another release`);
    const time = Date.parse(e.observedAt);
    if (!Number.isFinite(time) || time > now + 60_000 || now - time > 24 * 3600_000)
      throw new Error(`${kind} evidence is stale or future dated`);
    reports[kind] = e;
  }
  if (reports.publication.status !== 'published-bytes-checked' || reports.publication.containerLive !== true)
    throw new Error('Exact live publication readback required');
  if (reports.assets.status !== 'REVIEWED' ||
      JSON.stringify(reports.assets.assets) !== JSON.stringify(profile.assets)) throw new Error('Reviewed assets differ');
  if (reports.wallet.status !== 'REAL_ORIGIN_ACCEPTED' || reports.wallet.synthetic !== false ||
      !profile.gateways.some(g => g.origin === reports.wallet.origin) || reports.wallet.chainObserved !== 196)
    throw new Error('Actual origin wallet acceptance required; connectivity fixture is insufficient');
  const gatewayReport = reports.gateways;
  if (gatewayReport.status !== 'TWO_GATEWAYS_CHECKED' || gatewayReport.primaryBlockedDuringRecovery !== true ||
      gatewayReport.blockMechanism !== 'HTTPS_CONNECT_PROXY' ||
      gatewayReport.gateways?.length !== 2 ||
      !profile.gateways.every(g => gatewayReport.gateways.some((r: any) =>
        r.origin === g.origin && r.operator === g.operator && r.releaseBytesChecked === true)) ||
      !gatewayReport.gateways.some((g: any) => g.origin === profile.gateways[1].origin &&
        Number.isSafeInteger(g.blockedPrimaryConnections) && g.blockedPrimaryConnections > 0))
    throw new Error('Two real gateways and fault recovery evidence required');
  if (reports.security.status !== 'REVIEW_COMPLETED' || reports.security.unresolvedCritical !== 0 ||
      reports.security.unresolvedHigh !== 0 || typeof reports.security.reviewer !== 'string' ||
      !reports.security.reviewer.trim()) throw new Error('Security review with no unresolved high findings required');
  return { schemaVersion: 1, status: 'EVIDENCE_CONSISTENT_REQUIRES_HUMAN_APPROVAL', sourceCommit: profile.sourceCommit,
    manifestSha256: profile.manifestSha256, container: profile.container, observedAt: new Date(now).toISOString(),
    signingApproved: false, scope: 'Checks identity, digests, freshness and declared acceptance fields. ' +
      'Does not authenticate reviewer independence, gateway operator independence or human claims. ' +
      'Does not enable signing or modify the compiled token allowlist.' };
}
