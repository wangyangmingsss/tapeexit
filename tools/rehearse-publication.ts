import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { SOURCES } from '../src/config';
import { StrictRpc } from '../src/core/rpc';
import { digest, loadPublication } from './publish-core';
import { inspectPublication, parsePublishProfile } from './operations-core';
import { resumePublication } from './resume-publication-core';
import { verifyPublication } from './verify-publication-core';
import { startLocalEvm } from './local-evm';
import { rehearseOperations } from './rehearse-publication-core';

const output = 'release-artifacts/publication-rehearsal.json';
await mkdir('release-artifacts', { recursive: true });
await rm(output, { force: true });
if (process.argv.length !== 3) throw new Error('Usage: npm run rehearse:publication -- <publication-profile.json>');
const profileBytes = await readFile(process.argv[2]);
const profile = parsePublishProfile(JSON.parse(profileBytes.toString()));
const publication = await loadPublication('dist');
const mainnet = new StrictRpc(SOURCES);
const remaining = await resumePublication(mainnet, profile.container, publication);
if (!remaining.transactions.length) throw new Error('Publication already complete; use verify:publication');
const identity = await inspectPublication(mainnet, profile, remaining.transactions);
await mainnet.assertBlock(remaining.block);
const observedGasPrice = await mainnet.gasPrice();
const evm = await startLocalEvm({ url: SOURCES[0].url, block: remaining.block });
let report: unknown;
try {
  // StrictRpc normally reads head minus two. Advance only the disposable fork.
  await evm.request('evm_mine'); await evm.request('evm_mine'); await evm.request('evm_mine');
  const local = new StrictRpc([{ url: 'http://127.0.0.1', operator: 'same-local-evm-a' },
    { url: 'http://127.0.0.1', operator: 'same-local-evm-b' }], (_source, method, params) => evm.request(method, params));
  const localPlan = await resumePublication(local, profile.container, publication);
  if (JSON.stringify(localPlan.transactions) !== JSON.stringify(remaining.transactions))
    throw new Error('Fork continuation differs from dual-source publication prefix');
  await inspectPublication(local, profile, localPlan.transactions);
  const execution = await rehearseOperations(evm.request, profile, localPlan.transactions, observedGasPrice);
  await evm.request('evm_mine'); await evm.request('evm_mine');
  const readback = await verifyPublication(local, profile.container, publication, publication.manifestSha256);
  await mainnet.assertBlock(remaining.block);
  await mainnet.assertBlock(identity.block);
  const manifest = JSON.parse(publication.contents.find(c => c.file.path === 'release-manifest.json')!.bytes.toString());
  report = { schemaVersion: 1, status: 'ISOLATED_FORK_REHEARSAL_PASSED',
    observedAt: new Date().toISOString(), sourceCommit: manifest.sourceCommit, chainId: 196,
    manifestSha256: publication.manifestSha256, profileSha256: digest(profileBytes), container: profile.container,
    pinned: remaining.block, observedGasPriceWei: observedGasPrice.toString(), identity, execution, simulatedReadback: readback,
    limitations: ['Disposable local fork; no mainnet transaction or wallet signature',
      'Publisher impersonated and balance replaced in local memory',
      'Two local reader labels use the same EVM; they are not independent operators',
      'Fork data fetched from one upstream; exact initial file prefixes checked against two sources',
      'Simulated gas excludes activation, domains and chain-specific fee components',
      'Does not approve code, assets, origin, reviewer identity or future mainnet state',
      'This report cannot serve as actual publication evidence for preflight:release'] };
} finally { await evm.close(); }
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Local publication rehearsal passed: ${remaining.transactions.length} operations; no mainnet writes. ${output}`);
