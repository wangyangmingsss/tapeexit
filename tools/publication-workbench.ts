import { readFile } from 'node:fs/promises';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { loadPublication } from './publish-core';
import { PublicationWorkbench } from './publication-workbench-core';
import { openPublicationJournal } from './publication-journal';
import { createPublicationWorkbenchServer } from './publication-workbench-server';

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
try {
  const workbench = new PublicationWorkbench(new StrictRpc(SOURCES), profile, publication, store.journal, store);
  const port = Number(portInput);
  const server = await createPublicationWorkbenchServer(workbench, port);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Keep the journal lock until any in-flight reservation has finished.
    server.close(() => { void store.close(); });
    server.closeIdleConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`TapeExit wallet publication: http://127.0.0.1:${port}/`);
  console.log('Wallet confirmation required for each upload or separately consented batch. Server has no signer or broadcast endpoint.');
  console.log(`Manifest: ${trustedDigest}`);
} catch (error) { await store.close(); throw error; }
