import { beforeEach, expect, it, vi } from 'vitest';
import type { StrictRpc, Block } from '../src/core/rpc';
import { inspectForkOwner } from '../tools/fork-owner';
import { BATCH_CODE_HASH, BATCH_IMPLEMENTATION, checkBatchCode, delegation } from '../tools/publication-batch';

vi.mock('../tools/publication-batch', async importOriginal => ({
  ...await importOriginal<typeof import('../tools/publication-batch')>(),
  checkBatchCode: vi.fn(),
}));
const block: Block = { number: '0x8', hash: `0x${'ab'.repeat(32)}`, timestamp: '0x1' };
const owner = '0x1000000000000000000000000000000000000001';
function fixture(code: unknown) {
  const request = vi.fn().mockResolvedValue(code);
  return { request, rpc: { request } as unknown as StrictRpc };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(checkBatchCode).mockResolvedValue(false); });
it('recognizes an empty-code sender at the exact supplied block', async () => {
  const { rpc, request } = fixture('0x');
  expect(await inspectForkOwner(rpc, owner, block)).toEqual({ kind: 'EMPTY_CODE_EOA', code: '0x' });
  expect(request).toHaveBeenCalledWith('eth_getCode', [owner, block.number]);
  expect(checkBatchCode).not.toHaveBeenCalled();
});
it('requires the pinned implementation check with upgrades forbidden', async () => {
  const { rpc } = fixture(delegation);
  expect(await inspectForkOwner(rpc, owner, block)).toEqual({
    kind: 'PINNED_EIP7702_DELEGATION', code: delegation,
    implementation: BATCH_IMPLEMENTATION, implementationCodeHash: BATCH_CODE_HASH,
  });
  expect(checkBatchCode).toHaveBeenCalledWith(rpc, owner, block, false);
});
it('fails closed when the known delegate implementation has changed', async () => {
  vi.mocked(checkBatchCode).mockRejectedValue(new Error('Batch implementation code pin mismatch'));
  await expect(inspectForkOwner(fixture(delegation).rpc, owner, block)).rejects.toThrow('code pin mismatch');
});
it.each(['0x6000', '0xef01000000000000000000000000000000000000000001',
  `${delegation}00`, null])('rejects arbitrary contract, unknown or malformed delegation: %s', async code => {
  await expect(inspectForkOwner(fixture(code).rpc, owner, block)).rejects.toThrow('Unsupported fork owner');
  expect(checkBatchCode).not.toHaveBeenCalled();
});
