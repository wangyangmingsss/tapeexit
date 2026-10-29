import { readFile } from 'node:fs/promises';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { loadPublication } from './publish-core';
import { PublicationWorkbench } from './publication-workbench-core';
import { openPublicationJournal } from './publication-journal';
import { createPublicationWorkbenchServer } from './publication-workbench-server';
import { PublicationActivation, type ActivationJournal } from './publication-activation';

if (process.argv.length < 5 || process.argv.length > 7)
  throw new Error('Usage: npm run publish:wallet -- <profile.json> <trusted-manifest-sha256> <journal.json> [port] [publication-directory]');
const [profilePath, trustedDigest, journalPath, portInput = '4183', publicationDirectory = 'dist'] = process.argv.slice(2);
const profile = JSON.parse(await readFile(profilePath, 'utf8'));
if (profile.purpose === 'LOCAL_REHEARSAL_ONLY_NOT_APPROVED')
  throw new Error('Local rehearsal funding profiles cannot be used for wallet publication');
const publication = await loadPublication(publicationDirectory);
if (!/^[a-f0-9]{64}$/.test(trustedDigest) || publication.manifestSha256 !== trustedDigest)
  throw new Error('Release manifest differs from the independently supplied digest');
const contextId = PublicationWorkbench.contextId(profile, trustedDigest);
const store = await openPublicationJournal(journalPath, contextId);
let activationStore: Awaited<ReturnType<typeof openPublicationJournal<ActivationJournal>>> | undefined;
try {
  const rpc = new StrictRpc(SOURCES);
  const workbench = new PublicationWorkbench(rpc, profile, publication, store.journal, store);
  const activationId = PublicationActivation.contextId(workbench);
  activationStore = await openPublicationJournal<ActivationJournal>(`${journalPath}.activation.json`, activationId,
    { schemaVersion: 1, contextId: activationId, attempts: [] });
  const activation = new PublicationActivation(rpc, workbench, activationStore.journal, activationStore);
  const port = Number(portInput);
  const server = await createPublicationWorkbenchServer(workbench, port, activation);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Keep the journal lock until any in-flight reservation has finished.
    server.close(() => { void Promise.all([store.close(), activationStore?.close()]); });
    server.closeIdleConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`TapeExit wallet publication: http://127.0.0.1:${port}/`);
  console.log('Confirm each upload separately in the wallet. Server has no signer or broadcast endpoint.');
  console.log(`Manifest: ${trustedDigest}`);
} catch (error) { await Promise.all([store.close(), activationStore?.close()]); throw error; }
