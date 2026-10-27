import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
// @ts-expect-error Shared zero-dependency recovery server is JavaScript.
import { createLocalServer } from '../tools/local-server.mjs';
describe('loopback recovery server', () => {
  let server: { close: () => void }; let root: string;
  afterAll(async () => { server?.close(); if (root) await rm(root, { recursive: true, force: true }); });
  it('serves local files with restrictive headers', async () => {
    root = await mkdtemp(join(tmpdir(), 'tapeexit-'));
    await writeFile(join(root, 'index.html'), '<h1>Recovery</h1>');
    await symlink('/etc/hosts', join(root, 'escape'));
    server = await createLocalServer(root, 14733);
    const response = await fetch('http://127.0.0.1:14733');
    expect(await response.text()).toContain('Recovery');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('blocks hostile Host, writes and symlink escape', async () => {
    const hostileHostStatus = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:14733', { headers: { host: 'evil.example' } }, res => {
        res.resume(); resolve(res.statusCode);
      });
      req.on('error', reject);
    });
    expect(hostileHostStatus).toBe(403);
    expect((await fetch('http://127.0.0.1:14733', { method: 'POST' })).status).toBe(405);
    expect((await fetch('http://127.0.0.1:14733/escape')).status).toBe(403);
  });
});
