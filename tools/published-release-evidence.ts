import { readFile } from 'node:fs/promises';
import { assertProfileManifest, parseGatewayProfile } from './release-profile-core';
import { digest } from './publish-core';

export async function loadPublishedReleaseEvidence() {
  const profile = parseGatewayProfile(JSON.parse(await readFile('docs/published-gateway-profile.json', 'utf8')));
  const directory = `docs/evidence/published-${profile.sourceCommit.slice(0, 7)}`;
  const sums = (await readFile(`${directory}/SHA256SUMS.txt`, 'utf8')).trim().split('\n');
  const json = async (name: string) => {
    const bytes = await readFile(`${directory}/${name}`);
    if (!sums.includes(`${digest(bytes)}  ${name}`)) throw new Error(`Published evidence digest differs: ${name}`);
    return JSON.parse(bytes.toString());
  };
  const acceptance = await json('public-acceptance.json');
  const wallet = await json('wallet-test.json');
  const manifest = await readFile(`${directory}/release-manifest.json`);
  assertProfileManifest(profile, manifest);
  if (acceptance.status !== 'PUBLISHED_VAULT_RECOVERY_CHECKED' ||
      acceptance.sourceCommit !== profile.sourceCommit || acceptance.manifestSha256 !== profile.manifestSha256 ||
      wallet.status !== 'RESTRICTED_MAINNET_TEST_FINALIZED' || wallet.remainingShares !== '0' ||
      wallet.remainingWalletConfirmations !== 0 || wallet.productionSigningApproved !== false ||
      acceptance.productionSigningApproved !== false)
    throw new Error('Published release evidence is incomplete or belongs to another version');
  return { ...profile, directory, observedAt: acceptance.observedAt, completedAt: acceptance.completedAt,
    status: acceptance.status, fileChecks: acceptance.fileChecks,
    restrictedWalletTest: { status: wallet.status, totalUsdcReturned: wallet.totalUsdcReturned,
      remainingShares: wallet.remainingShares, remainingWalletConfirmations: 0 },
    independentReview: 'NOT_COMPLETED', productionSigningApproved: false,
    scope: 'Recorded fixed-version publication, public read-only recovery and restricted wallet test; ' +
      'not live availability, approval of the current build or independent review.' };
}
