import { readFile } from 'node:fs/promises';
import { digest } from './publish-core';

const pins = {
  'publication.json': '37149fd76b05db63c66487a5600a683852b3b27443071f8d8a963867f897969d',
  'gateways.json': 'fdd454d91b3a3c3b0ea3d6e10995ed3d0f998d19a85e3e80f09f7f6069dc9b4e',
  'release-manifest.json': '8282142e417188b95421249ec7beb8993aaea65308c7e87b337c08a9c77415ba',
} as const;
export function verifyHistoricalEvidence(inputs: Record<string, Uint8Array>, candidateCommit: string) {
  if (!/^[a-f0-9]{40}$/.test(candidateCommit)) throw new Error('Invalid candidate commit');
  const reports: Record<string, any> = {};
  for (const [name, sha256] of Object.entries(pins)) {
    const bytes = inputs[name];
    if (!bytes || digest(bytes) !== sha256) throw new Error(`Historical evidence digest differs: ${name}`);
    reports[name] = JSON.parse(Buffer.from(bytes).toString('utf8'));
  }
  const publication = reports['publication.json'], gateways = reports['gateways.json'];
  const manifest = reports['release-manifest.json'];
  const sourceCommit = '733ca795d9216ea43038e386ee652c1a84f112b5';
  if ([publication, gateways, manifest].some(report => report.sourceCommit !== sourceCommit) ||
      publication.readback.manifestSha256 !== pins['release-manifest.json'] ||
      gateways.manifestSha256 !== pins['release-manifest.json'] ||
      publication.readback.status !== 'published-bytes-checked' ||
      gateways.status !== 'TWO_GATEWAYS_CHECKED' || gateways.primaryBlockedDuringRecovery !== true ||
      gateways.blockMechanism !== 'HTTPS_CONNECT_PROXY')
    throw new Error('Historical publication identities or status differ');
  return {
    schemaVersion: 1, status: 'HISTORICAL_PUBLICATION_EVIDENCE_CHECKED',
    sourceCommit, manifestSha256: pins['release-manifest.json'],
    candidateSourceCommit: candidateCommit, candidateMatchesPublishedSource: candidateCommit === sourceCommit,
    container: gateways.container, tapeName: gateways.tapeName, chainId: 196,
    publicationObservedAt: publication.observedAt, gatewaysObservedAt: gateways.observedAt,
    uploadedFiles: publication.readback.files.length, totalBytes: publication.readback.totalBytes,
    uploadOperations: publication.confirmedSteps, uploadTransactions: publication.confirmedTransactions,
    gateways: gateways.gateways.map((g: any) => ({ origin: g.origin, operator: g.operator,
      filesChecked: g.filesChecked, blockedPrimaryConnections: g.blockedPrimaryConnections })),
    publicationTransactions: publication.transactions.map((tx: any) => tx.hash),
    files: Object.entries(pins).map(([path, sha256]) => ({ path, sha256 })),
    signingApproved: false, mainnetExitTransaction: null, independentReview: null,
    limitations: 'Digest checks preserve recorded observations, not current live availability or source approval. ' +
      'Upload transactions are not exit transactions. Gateway tests were browser read-only tasks, not extension ' +
      'signing. Historical evidence does not accept a newer candidate. No new network check is performed here.',
  };
}
export async function loadHistoricalEvidence(candidateCommit: string) {
  const inputs: Record<string, Uint8Array> = {};
  for (const name of Object.keys(pins)) inputs[name] = await readFile(`evidence/historical/${name}`);
  return verifyHistoricalEvidence(inputs, candidateCommit);
}
