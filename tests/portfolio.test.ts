import { expect, it, vi } from 'vitest';
import { readPortfolio } from '../src/core/portfolio';
import { discoverPositions } from '../src/core/discovery';
import { V3Adapter } from '../src/core/adapter';
import { StrictRpc } from '../src/core/rpc';
import type { Snapshot } from '../src/core/protocol';
vi.mock('../src/core/discovery', () => ({ discoverPositions: vi.fn() }));
const owner = '0x1000000000000000000000000000000000000001';
const block = { number: '0x10', hash: `0x${'12'.repeat(32)}`, timestamp: '0x1' } as const;
function position(tokenId: bigint): Snapshot {
  return { tokenId, owner, block, pool: owner,
    token0: { address: owner, symbol: 'A', decimals: 6, verified: false },
    token1: { address: owner, symbol: 'B', decimals: 6, verified: false },
    fee: 500, tickLower: -10, tickUpper: 10, tick: 0, liquidity: 8n,
    sqrtPriceX96: 2n ** 96n, poolLiquidity: 80n, owed0: 0n, owed1: 0n };
}
function fixture() {
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }]);
  vi.spyOn(rpc, 'assertBlock').mockResolvedValue();
  const adapter = new V3Adapter(rpc);
  const snapshot = vi.spyOn(adapter, 'snapshotAt').mockImplementation(async tokenId => position(tokenId));
  vi.mocked(discoverPositions).mockReset().mockResolvedValue({
    owner, block, total: 7n, offset: 0n, next: 5n, tokenIds: [2n ** 200n, 5n],
  });
  return { adapter, rpc, snapshot };
}
it('pins snapshots to enumeration, preserves large IDs, and bounds pagination', async () => {
  const { adapter, snapshot } = fixture();
  const page = await readPortfolio(adapter, owner);
  expect(page.entries.map(entry => entry.state)).toEqual(['ready', 'ready']);
  expect(page.entries[0].tokenId).toBe(2n ** 200n);
  expect(snapshot.mock.calls.every(call => call[1] === block)).toBe(true);
  await readPortfolio(adapter, owner, { offset: page.next!, block });
  expect(discoverPositions).toHaveBeenLastCalledWith(adapter, owner, { offset: 5n, block, limit: 5 });
});
it('keeps failed, transferred or mismatched NFTs visible as unavailable', async () => {
  const { adapter, snapshot } = fixture();
  snapshot.mockRejectedValueOnce(new Error('timeout'));
  snapshot.mockResolvedValueOnce({ ...position(5n), owner: '0x2000000000000000000000000000000000000002' });
  const page = await readPortfolio(adapter, owner);
  expect(page.total).toBe(7n);
  expect(page.entries.map(entry => entry.state)).toEqual(['unavailable', 'unavailable']);
});
it('does not accept a snapshot from another block or token ID', async () => {
  const { adapter, snapshot } = fixture();
  snapshot.mockResolvedValueOnce(position(1n));
  snapshot.mockResolvedValueOnce({ ...position(5n), block: { ...block, hash: `0x${'34'.repeat(32)}` } });
  expect((await readPortfolio(adapter, owner)).entries.every(entry => entry.state === 'unavailable')).toBe(true);
});
it('rejects final block reorgs rather than returning stale positions', async () => {
  const { adapter, rpc } = fixture();
  vi.mocked(rpc.assertBlock).mockRejectedValue(new Error('reorg'));
  await expect(readPortfolio(adapter, owner)).rejects.toThrow('reorg');
});
it('stops on cancellation before reading the next snapshot', async () => {
  const { adapter, snapshot } = fixture();
  const controller = new AbortController();
  snapshot.mockImplementationOnce(async tokenId => { controller.abort(); return position(tokenId); });
  await expect(readPortfolio(adapter, owner, { signal: controller.signal })).rejects.toThrow();
  expect(snapshot).toHaveBeenCalledTimes(1);
});
