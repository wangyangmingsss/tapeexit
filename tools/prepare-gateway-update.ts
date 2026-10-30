import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getAddress } from 'viem';
import { RELEASE_APPROVED, SUPPORTED_TOKENS } from '../src/config';
import { loadPublication, preparePublication } from './publish-core';
import { assertProfileManifest, parseGatewayProfile } from './release-profile-core';
import { incrementalUpdateOperations, updateRemovals } from './resume-publication-update';

const [previousDirectory, previousDigest, ...extra] = process.argv.slice(2);
if (extra.length || !!previousDirectory !== !!previousDigest)
  throw new Error('Usage: npm run prepare:gateway-update -- [previous-publication-directory trusted-previous-manifest-sha256]');
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw new Error('Production signing must remain disabled');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit the exact source before preparing gateway update');
const sourceCommit = git('rev-parse', 'HEAD');
const publication = await loadPublication('dist');
const previous = previousDirectory ? await loadPublication(previousDirectory) : undefined;
if (previous && previous.manifestSha256 !== previousDigest)
  throw new Error('Previous release differs from the independently supplied manifest digest');
const manifest = publication.contents.find(c => c.file.path === 'release-manifest.json')!;
const profile = parseGatewayProfile({
  schemaVersion: 1, chainId: 196, sourceCommit, manifestSha256: publication.manifestSha256,
  container: '0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D', tapeName: '2.2.289.tape',
  gateways: [
    { origin: 'https://2-2-289.netlify.app', operator: 'netlify' },
    { origin: 'https://2-2-289.vercel.app', operator: 'vercel' },
  ],
});
assertProfileManifest(profile, manifest.bytes);
const directory = 'release-artifacts/gateway-update';
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
const save = (name: string, data: unknown) => writeFile(`${directory}/${name}`, JSON.stringify(data, null, 2) + '\n');
await save('profile.json', profile);
await cp('dist', `${directory}/publication`, { recursive: true });
await cp('dist-gateway', `${directory}/Netlify-Gateway`, { recursive: true });
await cp('dist-gateway', `${directory}/Vercel-Gateway`, { recursive: true });
const vercel = JSON.parse(await readFile('vercel.json', 'utf8'));
await writeFile(`${directory}/Vercel-Gateway/vercel.json`, JSON.stringify({
  ...vercel, buildCommand: null, outputDirectory: '.',
}, null, 2) + '\n');
const unsigned = await preparePublication('dist', getAddress(profile.container));
const removals = previous ? updateRemovals(getAddress(profile.container), publication, previous) : [];
if (previousDirectory) await cp(previousDirectory, `${directory}/previous-publication`, { recursive: true });
await save('unsigned-publication-plan.json', { ...profile, status: 'UNSIGNED_NOT_AUTHORIZED',
  signingApproved: false, independentReview: 'NOT_COMPLETED', transactionCount: unsigned.transactions.length + removals.length,
  incrementalOperationCountUpperBound: previous
    ? incrementalUpdateOperations(getAddress(profile.container), publication, previous).length : unsigned.transactions.length,
  previousManifestSha256: previous?.manifestSha256 ?? null,
  transactions: [...removals, ...unsigned.transactions], activationIncluded: false,
  note: 'Historical operation IDs and fee ceilings are conservative. The live incremental continuation reuses exact files and fallback. ' +
    'No gas estimate, fee consent, upload, activation, hosting deployment or mainnet readiness is implied.' });
for (const name of ['Netlify-Gateway', 'Vercel-Gateway'])
  execFileSync('zip', ['-q', '-r', resolve(`${directory}/${name}.zip`), '.'], { cwd: `${directory}/${name}` });
await save('status.json', { ...profile, observedAt: new Date().toISOString(),
  status: 'PREPARED_NOT_DEPLOYED', productionSigningApproved: false, independentReview: 'NOT_COMPLETED',
  publicationOperations: unsigned.transactions.length + removals.length, migrationBaselineIncluded: !!previous,
  required: ['Confirm bounded upload fees in the original wallet', 'Upload and read back the exact release',
    'Use authenticated hosting access to deploy each gateway', 'Run candidate public fault recovery acceptance'],
  ordering: 'Re-upload application bytes to the container before candidate gateway acceptance. Bootstrap deployment alone does not update the chain application.',
});
console.log(`Prepared ${directory}: ${unsigned.transactions.length + removals.length} unsigned publication operations; migration baseline ${previous ? 'included' : 'not included'}; no transaction or deployment sent.`);
