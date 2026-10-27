import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictRpc, type Block, type Requester } from '../src/core/rpc';

const sources = [{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }];
const hash = `0x${'ab'.repeat(32)}` as const;
const otherHash = `0x${'cd'.repeat(32)}` as const;
const now = 1_800_000_000;
const quantity = (n: number) => `0x${n.toString(16)}` as const;
const block: Block = { number: '0x10', hash, timestamp: quantity(now) };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now * 1000); });
afterEach(() => { vi.useRealTimers(); });
describe('block identity and snapshot freshness', () => {
  it('accepts the requested height and projects only the agreed block fields', async () => {
    const rpc = new StrictRpc(sources, async source => ({ ...block, providerNote: source.operator }));
    expect(await rpc.block('0x10')).toEqual(block);
  });
  it('rejects two agreeing sources that return a different requested height', async () => {
    const rpc = new StrictRpc(sources, async () => ({ ...block, number: '0x11' }));
    await expect(rpc.block('0x10')).rejects.toMatchObject({ code: 'RPC_INVALID' });
    await expect(rpc.assertBlock(block)).rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
  it.each([
    null, {}, 'not-a-block',
    { ...block, number: '16' }, { ...block, number: 16 }, { ...block, number: '0x010' },
    { ...block, timestamp: '-1' }, { ...block, timestamp: null }, { ...block, timestamp: '0x' },
    { ...block, timestamp: `0x1${'0'.repeat(64)}` },
    { ...block, hash: '0xab' }, { ...block, hash: `0x${'gg'.repeat(32)}` },
  ])('rejects malformed agreeing block responses %j', async response => {
    const rpc = new StrictRpc(sources, async () => response);
    await expect(rpc.block('0x10')).rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
  it('rejects invalid request heights before contacting an RPC', async () => {
    const request = vi.fn(async () => block);
    const rpc = new StrictRpc(sources, request);
    await expect(rpc.block('0x010')).rejects.toMatchObject({ code: 'RPC_INVALID' });
    expect(request).not.toHaveBeenCalled();
  });
  it('accepts a zero-height genesis block and timestamp for historical verification', async () => {
    const genesis: Block = { ...block, number: '0x0', timestamp: '0x0' };
    expect(await new StrictRpc(sources, async () => genesis).block('0x0')).toEqual(genesis);
  });
  it.each(['safe', 'finalized'] as const)('checks the schema of a %s tag without requiring a numeric tag', async tag => {
    expect(await new StrictRpc(sources, async () => block).block(tag)).toEqual(block);
    await expect(new StrictRpc(sources, async () => ({ ...block, hash: null })).block(tag))
      .rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
  it('still distinguishes disagreeing hashes and a canonical block changing during recheck', async () => {
    await expect(new StrictRpc(sources, async source => ({
      ...block, hash: source.operator === 'a' ? hash : otherHash,
    })).block('0x10')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(new StrictRpc(sources, async () => ({ ...block, hash: otherHash })).assertBlock(block))
      .rejects.toMatchObject({ code: 'REORG' });
  });
  function heads(offset = 0, head: unknown = '0x12', returnedHeight = '0x10'): Requester {
    return async (_source, method) => method === 'eth_blockNumber' ? head :
      { ...block, number: returnedHeight, timestamp: quantity(now + offset) };
  }
  it('pins two blocks behind the lower head and keeps a valid current snapshot', async () => {
    const request: Requester = vi.fn(async (source, method, params) => {
      if (method === 'eth_blockNumber') return source.operator === 'a' ? '0x12' : '0x14';
      expect(params).toEqual(['0x10', false]);
      return block;
    });
    expect(await new StrictRpc(sources, request).pin()).toEqual(block);
  });
  it.each([-301, 31])('rejects a snapshot timestamp offset by %s seconds', async offset => {
    await expect(new StrictRpc(sources, heads(offset)).pin()).rejects.toMatchObject({ code: 'STALE' });
  });
  it.each([-300, 30])('accepts the timestamp tolerance boundary at %s seconds', async offset => {
    expect((await new StrictRpc(sources, heads(offset)).pin()).timestamp).toBe(quantity(now + offset));
  });
  it.each([null, '18', 18, '0x012', '-0x1', `0x1${'0'.repeat(64)}`])(
    'rejects malformed head height %j before reading a snapshot', async head => {
      const request = vi.fn(heads(0, head));
      await expect(new StrictRpc(sources, request).pin()).rejects.toMatchObject({ code: 'RPC_INVALID' });
      expect(request.mock.calls.every(([, method]) => method === 'eth_blockNumber')).toBe(true);
    });
  it('rejects a substituted block even when its timestamp is fresh', async () => {
    await expect(new StrictRpc(sources, heads(0, '0x12', '0x11')).pin())
      .rejects.toMatchObject({ code: 'RPC_INVALID' });
  });
  it('rejects excessively divergent heads', async () => {
    const rpc = new StrictRpc(sources, async source => source.operator === 'a' ? '0x12' : '0x200');
    await expect(rpc.pin()).rejects.toMatchObject({ code: 'STALE' });
  });
});
