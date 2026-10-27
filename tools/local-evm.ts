import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ipc } from 'viem/node';
import type { Block } from '../src/core/rpc';

// No caller-supplied write endpoint: every request uses the socket of this child.
export async function startLocalEvm(fork?: { url: string; block: Block }) {
  const directory = await mkdtemp(join(tmpdir(), 'tapeexit-'));
  const socket = join(directory, 'evm.ipc');
  const args = ['node_modules/@foundry-rs/anvil/bin.mjs', '--host', '127.0.0.1',
    '--port', '0', '--accounts', '0', '--chain-id', '196', '--ipc', socket, '--silent', '--no-cors'];
  if (fork) args.push('--fork-url', fork.url, '--fork-block-number', BigInt(fork.block.number).toString(),
    '--no-storage-caching');
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let failure = '';
  child.stderr?.on('data', bytes => { failure = (failure + bytes.toString()).slice(-2000); });
  child.on('error', error => { failure = error.message; });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  const transport = ipc(socket, { retryCount: 0, reconnect: false, timeout: 15000 })({});
  let connected = false, disposed = false;
  const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60_000);
  const request = async (method: string, params: unknown[] = []) => {
    if (disposed || child.exitCode !== null || child.signalCode !== null || failure && !child.pid)
      throw new Error('Isolated EVM is unavailable');
    return transport.request({ method, params });
  };
  async function close() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    if (connected) {
      try { (await transport.value!.getRpcClient()).close(); } catch { /* Child may already have exited. */ }
    }
    if (child.exitCode === null && child.signalCode === null && child.pid) child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(force);
    await rm(directory, { recursive: true, force: true });
  }
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null || failure && !child.pid) throw new Error(`Anvil startup failed: ${failure}`);
      if (await stat(socket).then(s => s.isSocket(), () => false)) { connected = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!connected || await request('eth_chainId') !== '0xc4') throw new Error(`Anvil not ready: ${failure}`);
    if (fork) {
      const block = await request('eth_getBlockByNumber', [fork.block.number, false]) as Block;
      if (block?.hash?.toLowerCase() !== fork.block.hash.toLowerCase())
        throw new Error('Fork source differs from the independently pinned block');
    }
    return { request, close };
  } catch (error) { await close(); throw error; }
}
