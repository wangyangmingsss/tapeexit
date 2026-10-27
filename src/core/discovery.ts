import { getAddress, type Address } from 'viem';
import { managerAbi } from '../config';
import { V3Adapter } from './protocol';
import { ExitError, type Block } from './rpc';

export interface PositionPage {
  owner: Address; block: Block; total: bigint; offset: bigint; next: bigint | null; tokenIds: bigint[];
}
export async function discoverPositions(adapter: V3Adapter, owner: Address,
  options: { offset?: bigint; limit?: number; block?: Block; signal?: AbortSignal } = {}): Promise<PositionPage> {
  const offset = options.offset ?? 0n, limit = options.limit ?? 10;
  if (offset < 0n || offset >= 2n ** 256n || !Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new ExitError('INPUT', 'Invalid discovery page');
  const checkCancelled = () => options.signal?.throwIfAborted();
  checkCancelled();
  const account = getAddress(owner);
  const block = options.block ?? await adapter.rpc.pin();
  checkCancelled();
  await adapter.verifyDeployment(block);
  checkCancelled();
  const total = await adapter.read<bigint>(managerAbi, adapter.deployment.manager, 'balanceOf', [account], block);
  if (offset > total) throw new ExitError('INPUT', 'Discovery offset exceeds balance');
  const end = offset + BigInt(limit) < total ? offset + BigInt(limit) : total;
  const tokenIds: bigint[] = [];
  for (let index = offset; index < end; index++) {
    checkCancelled();
    const tokenId = await adapter.read<bigint>(managerAbi, adapter.deployment.manager,
      'tokenOfOwnerByIndex', [account, index], block);
    checkCancelled();
    const actualOwner = await adapter.read<Address>(managerAbi, adapter.deployment.manager, 'ownerOf', [tokenId], block);
    if (getAddress(actualOwner) !== account || tokenIds.includes(tokenId))
      throw new ExitError('DISCOVERY', 'Enumeration ownership or uniqueness mismatch');
    tokenIds.push(tokenId);
  }
  checkCancelled();
  await adapter.rpc.assertBlock(block);
  checkCancelled();
  return { owner: account, block, total, offset, next: end < total ? end : null, tokenIds };
}
