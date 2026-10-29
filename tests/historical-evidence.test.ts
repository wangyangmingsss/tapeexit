import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { verifyHistoricalEvidence } from '../tools/historical-evidence';

async function inputs() {
  return Object.fromEntries(await Promise.all(['publication.json', 'gateways.json', 'release-manifest.json']
    .map(async name => [name, await readFile(`evidence/historical/${name}`)])));
}
it('preserves published source without approving the current candidate or claiming an exit', async () => {
  const report = verifyHistoricalEvidence(await inputs(), 'a'.repeat(40));
  expect(report).toMatchObject({ candidateMatchesPublishedSource: false, signingApproved: false,
    uploadedFiles: 9, totalBytes: 587736, uploadOperations: 31, uploadTransactions: 23,
    mainnetExitTransaction: null, independentReview: null });
  expect(report.gateways).toHaveLength(2);
  expect(report.gateways[1].blockedPrimaryConnections).toBeGreaterThan(0);
});
it('rejects tampering and missing evidence', async () => {
  const bytes = await inputs();
  bytes['gateways.json'] = Buffer.from(bytes['gateways.json'].toString().replace('TWO_GATEWAYS_CHECKED', 'APPROVED'));
  expect(() => verifyHistoricalEvidence(bytes, 'a'.repeat(40))).toThrow('digest differs');
  expect(() => verifyHistoricalEvidence({}, 'a'.repeat(40))).toThrow();
});
