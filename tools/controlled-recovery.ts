import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { StrictRpc } from '../src/core/rpc';
import { SOURCES } from '../src/config';
import { ControlledTest, type TestJournal } from './controlled-test-core';
import { createControlledTestServer } from './controlled-test-server';

const [path, port = '4187', ...extra] = process.argv.slice(2);
if (!path || extra.length) throw new Error('Usage: npm run recover:test -- <existing-journal.json> [port]');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit the exact source before starting recovery');
// Load an atomic journal snapshot without taking over the active writer's lock.
const journal = JSON.parse(await readFile(path, 'utf8')) as TestJournal;
if (!journal.attempts?.some(a => a.hash)) throw new Error('Saved transaction hash required');
const bench = new ControlledTest(new StrictRpc(SOURCES), journal, {
  async save() { /* Read-only recovery results live in memory and can be exported by the user. */ },
});
const server = await createControlledTestServer(bench, Number(port), git('rev-parse', 'HEAD'), { readOnly: true });
const stop = () => { server.close(); server.closeIdleConnections(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
console.log(`TapeExit read-only recovery: http://127.0.0.1:${port}/`);
console.log('Existing journal preserved. No wallet connection, signing, broadcast or new exit routes.');
