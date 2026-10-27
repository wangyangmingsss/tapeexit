import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
describe('targeted transitive dependency fixes', () => {
  it('keeps solc temporary-file creation and removal working with the patched tmp', () => {
    const solcRequire = createRequire(require.resolve('solc'));
    const tmp = solcRequire('tmp');
    expect(solcRequire('tmp/package.json').version).toBe('0.2.7');
    const file = tmp.fileSync({ postfix: '.smt2', discardDescriptor: true });
    try { expect(existsSync(file.name)).toBe(true); }
    finally { file.removeCallback(); }
    expect(existsSync(file.name)).toBe(false);
  });
  it('preserves patch generation/application for the installed Mocha diff dependency', () => {
    const hardhatRequire = createRequire(require.resolve('hardhat/package.json'));
    const mochaRequire = createRequire(hardhatRequire.resolve('mocha/package.json'));
    const diff = mochaRequire('diff');
    const oldText = 'first\nsecond\n', newText = 'first\nthird\n';
    expect(diff.applyPatch(oldText, diff.createPatch('fixture', oldText, newText))).toBe(newText);
    const serializer = mochaRequire('serialize-javascript');
    const serialized = serializer({ payload: '</script><script>bad()</script>', date: new Date(0) });
    expect(serialized).not.toContain('</script');
    expect(serialized).toContain('1970-01-01');
    // Verify the exact resolved package rather than assuming the root package is used.
    const packageFile = mochaRequire.resolve('serialize-javascript/package.json');
    expect(JSON.parse(readFileSync(packageFile, 'utf8')).version).toBe('7.1.3');
  });
  it('preserves Hardhat compiler ZIP extraction and UUID generation with patched dependencies', async () => {
    const consumer = createRequire(require.resolve('hardhat/package.json'));
    const Zip = consumer('adm-zip');
    const folder = await mkdtemp(join(tmpdir(), 'tapeexit-zip-'));
    try {
      const archive = new Zip();
      archive.addFile('compiler/solc', Buffer.from('fixture compiler bytes'));
      const restored = new Zip(archive.toBuffer());
      restored.extractAllTo(folder, true);
      expect(await readFile(join(folder, 'compiler/solc'), 'utf8')).toBe('fixture compiler bytes');
      expect(consumer('uuid').v4()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      const sentry = createRequire(consumer.resolve('@sentry/node/package.json'));
      const cookie = sentry('cookie');
      expect(cookie.parse('session=hello%20world').session).toBe('hello world');
      expect(cookie.serialize('session', 'hello world', { httpOnly: true })).toBe('session=hello%20world; HttpOnly');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it('preserves the actual Hardhat HTTP provider request path with patched undici', async () => {
    const consumer = createRequire(require.resolve('hardhat/package.json'));
    const { HttpProvider } = consumer('./internal/core/providers/http.js');
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const request = JSON.parse(body);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '0xc4' }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const provider = new HttpProvider(`http://127.0.0.1:${port}`, 'fixture', {}, 1000);
      expect(await provider.request({ method: 'eth_chainId' })).toBe('0xc4');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
