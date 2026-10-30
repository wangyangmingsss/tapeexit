import { execFileSync } from 'node:child_process';
import { StrictRpc } from '../src/core/rpc';
import { RELEASE_APPROVED, SOURCES, SUPPORTED_TOKENS } from '../src/config';
import { VaultWalletTest, type VaultTestJournal } from './vault-wallet-core';
import { openPublicationJournal } from './publication-journal';
import { createControlledTestServer } from './controlled-test-server';

const [journal = 'release-artifacts/spark-vault/wallet-journal.json', port = '4196', ...extra] = process.argv.slice(2);
if (extra.length) throw Error('Usage: npm run test:vault-wallet -- [journal.json] [port]');
if (RELEASE_APPROVED || SUPPORTED_TOKENS.length) throw Error('Production signing gates must remain closed');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw Error('Run the wallet test from a clean committed source checkout');
const source = git('rev-parse', 'HEAD'), contextId = VaultWalletTest.contextId;
const store = await openPublicationJournal<VaultTestJournal>(journal, contextId,
  { schemaVersion: 1, contextId, baseline: null, attempts: [] });
try {
  const test = new VaultWalletTest(new StrictRpc(SOURCES), store.journal, store);
  const server = await createControlledTestServer(test, Number(port), source, { assets: 'controlled-vault' });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void store.close(); }); server.closeIdleConnections();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(`TapeExit Spark vault wallet test: http://127.0.0.1:${port}/`);
  console.log(`Source ${source}; at most 1 USDC deposit; exact approval; self-only partial/full redemption.`);
  console.log('No server signer or broadcast endpoint. Confirm each transaction in the original OKX extension.');
} catch (error) { await store.close(); throw error; }
