import { execFileSync } from 'node:child_process';
import { StrictRpc } from '../src/core/rpc';
import { RELEASE_APPROVED, SOURCES, SUPPORTED_TOKENS } from '../src/config';
import { ControlledTest, type TestJournal } from './controlled-test-core';
import { openPublicationJournal } from './publication-journal';
import { createControlledTestServer } from './controlled-test-server';

const [path = 'release-artifacts/controlled-test-67042.json', port = '4184', ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Usage: npm run test:wallet -- [journal.json] [port]');
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw new Error('Production gates must remain closed');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit and verify the exact clean source before starting the wallet test');
const sourceCommit = git('rev-parse', 'HEAD'), contextId = ControlledTest.contextId;
const store = await openPublicationJournal<TestJournal>(path, contextId,
  { schemaVersion: 1, contextId, attempts: [] });
try {
  const bench = new ControlledTest(new StrictRpc(SOURCES), store.journal, store);
  const server = await createControlledTestServer(bench, Number(port), sourceCommit);
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    server.close(() => { void store.close(); }); server.closeIdleConnections();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(`TapeExit controlled mainnet test: http://127.0.0.1:${port}/`);
  console.log(`Source: ${sourceCommit}; position 67042 only; production signing remains disabled.`);
  console.log('No signer or broadcast endpoint. Confirm the exact small test and fees in your original extension.');
} catch (error) { await store.close(); throw error; }
