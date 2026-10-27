import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

export async function createRecoveryProxy(blockedHost: string,
  connector: (host: string, port: number) => Socket = (host, port) => connect({ host, port })) {
  const sockets = new Set<Duplex>();
  let blocked = 0;
  const server = createServer((_req, res) => { res.writeHead(405); res.end(); });
  server.on('connect', (request, client, head) => {
    sockets.add(client);
    client.once('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    let target: URL;
    try {
      const authority = request.url ?? '';
      target = new URL(`https://${authority}`);
      if (target.username || target.password || target.pathname !== '/' || target.search || target.hash ||
          !authority.endsWith(':443') || target.port)
        throw new Error('Only HTTPS CONNECT on port 443 is allowed');
    } catch {
      client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    if (target.hostname.toLowerCase().replace(/\.$/, '') === blockedHost.toLowerCase().replace(/\.$/, '')) {
      blocked++;
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = connector(target.hostname, 443);
    sockets.add(upstream);
    upstream.once('close', () => sockets.delete(upstream));
    upstream.setTimeout(90_000, () => upstream.destroy());
    upstream.once('error', () => client.destroy());
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    upstream.once('connect', () => {
      if (client.destroyed) return upstream.destroy();
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    blockedCount: () => blocked,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
