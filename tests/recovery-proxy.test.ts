import { describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { createRecoveryProxy } from '../tools/recovery-proxy';

async function tunnel(proxy: string, authority: string) {
  const url = new URL(proxy);
  return new Promise<{ status: number; socket: net.Socket }>((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, method: 'CONNECT', path: authority });
    request.once('connect', (response, socket) => resolve({ status: response.statusCode!, socket: socket as net.Socket }));
    request.once('error', reject);
    request.end();
  });
}
describe('network proxy recovery boundary', () => {
  it('blocks the primary host before opening any upstream socket, including case and trailing-dot aliases', async () => {
    let calls = 0;
    const proxy = await createRecoveryProxy('primary.example', () => { calls++; throw new Error('Unexpected upstream'); });
    try {
      for (const host of ['primary.example', 'PRIMARY.EXAMPLE', 'primary.example.']) {
        const response = await tunnel(proxy.url, `${host}:443`);
        expect(response.status).toBe(403);
        response.socket.destroy();
      }
      expect(calls).toBe(0);
      expect(proxy.blockedCount()).toBe(3);
    } finally { await proxy.close(); }
  });
  it('rejects unsafe CONNECT authorities instead of becoming an arbitrary-port proxy', async () => {
    const proxy = await createRecoveryProxy('primary.example', () => { throw new Error('Unexpected upstream'); });
    try {
      for (const authority of ['backup.example:80', 'user:pass@backup.example:443', 'backup.example:443/other']) {
        const response = await tunnel(proxy.url, authority);
        expect(response.status).toBe(400);
        response.socket.destroy();
      }
      expect(proxy.blockedCount()).toBe(0);
    } finally { await proxy.close(); }
  });
  it('preserves opaque backup tunnel bytes and closes active sockets on shutdown', async () => {
    const upstream = net.createServer(socket => socket.once('data', bytes => {
      expect(bytes.toString()).toBe('opaque TLS fixture');
      socket.write('opaque reply');
    }));
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const requests: [string, number][] = [];
    const proxy = await createRecoveryProxy('primary.example', (host, port) => {
      requests.push([host, port]);
      return net.connect({ host: '127.0.0.1', port: (upstream.address() as { port: number }).port });
    });
    try {
      const response = await tunnel(proxy.url, 'backup.example:443');
      expect(response.status).toBe(200);
      const reply = new Promise<Buffer>(resolve => response.socket.once('data', resolve));
      response.socket.write('opaque TLS fixture');
      expect((await reply).toString()).toBe('opaque reply');
      expect(requests).toEqual([['backup.example', 443]]);
      const closed = new Promise<void>(resolve => response.socket.once('close', () => resolve()));
      response.socket.resume();
      await proxy.close();
      await closed;
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  });
});
