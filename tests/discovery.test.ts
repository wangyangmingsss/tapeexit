import { expect, it, vi } from 'vitest';
import { discoverPositions } from '../src/core/discovery';
import { V3Adapter } from '../src/core/protocol';
import { StrictRpc } from '../src/core/rpc';

const owner = '0x1000000000000000000000000000000000000001';
const block = { number: '0x10', hash: `0x${'12'.repeat(32)}`, timestamp: '0x1' } as const;
function fixture() {
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }]);
  vi.spyOn(rpc, 'pin').mockResolvedValue(block);
  vi.spyOn(rpc, 'assertBlock').mockResolvedValue();
  const adapter = new V3Adapter(rpc);
  vi.spyOn(adapter, 'verifyDeployment').mockResolvedValue();
  const read = vi.spyOn(adapter, 'read').mockImplementation(async (_abi, _to, name, args, b) => {
    expect(b).toBe(block);
    if (name === 'balanceOf') return 25n;
    if (name === 'ownerOf') return owner;
    return 2n ** 200n + (args[1] as bigint);
  });
  return { adapter, rpc, read };
}
it('bounds enumeration, preserves bigint IDs and continues the same fixed block', async () => {
  const { adapter, rpc } = fixture();
  const page = await discoverPositions(adapter, owner, { limit: 20 });
  expect(page.tokenIds).toHaveLength(20);
  expect(page.next).toBe(20n);
  const last = await discoverPositions(adapter, owner, { offset: page.next!, block: page.block });
  expect(last.tokenIds).toHaveLength(5);
  expect(last.next).toBeNull();
  expect(rpc.pin).toHaveBeenCalledTimes(1);
});
it('rejects invalid page sizes and offsets before issuing reads', async () => {
  const { adapter, read } = fixture();
  for (const options of [{ limit: 21 }, { limit: 0 }, { offset: -1n }, { offset: 2n ** 256n }])
    await expect(discoverPositions(adapter, owner, options)).rejects.toMatchObject({ code: 'INPUT' });
  expect(read).not.toHaveBeenCalled();
});
it('rejects changed ownership and duplicate enumeration', async () => {
  const { adapter, read } = fixture();
  read.mockImplementation(async (_a, _t, name) => name === 'balanceOf' ? 2n : name === 'ownerOf' ? owner : 1n);
  await expect(discoverPositions(adapter, owner)).rejects.toMatchObject({ code: 'DISCOVERY' });
  read.mockImplementation(async (_a, _t, name) => name === 'balanceOf' ? 1n : name === 'ownerOf' ?
    '0x2000000000000000000000000000000000000002' : 1n);
  await expect(discoverPositions(adapter, owner)).rejects.toMatchObject({ code: 'DISCOVERY' });
});
it('stops after cancellation without exposing a partial page', async () => {
  const { adapter, read } = fixture();
  const controller = new AbortController();
  read.mockImplementation(async () => { controller.abort(); return 25n; });
  await expect(discoverPositions(adapter, owner, { signal: controller.signal })).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
});
it('propagates deployment, enumeration and reorg failures', async () => {
  const { adapter, rpc, read } = fixture();
  read.mockRejectedValueOnce(new Error('enumeration unavailable'));
  await expect(discoverPositions(adapter, owner)).rejects.toThrow('unavailable');
  vi.mocked(rpc.assertBlock).mockRejectedValueOnce(new Error('reorg'));
  await expect(discoverPositions(adapter, owner)).rejects.toThrow('reorg');
});
