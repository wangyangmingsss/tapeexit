import { getAddress, type Address } from 'viem';
import { discoverPositions, type PositionPage } from './discovery';
import type { V3Adapter } from './adapter';
import type { Snapshot } from './protocol';
import { ExitError, type Block } from './rpc';

export type PortfolioEntry =
  | { tokenId: bigint; state: 'ready'; snapshot: Snapshot }
  | { tokenId: bigint; state: 'unavailable' };
export interface PortfolioPage extends PositionPage { entries: PortfolioEntry[] }

// Enumeration and snapshots share a pinned block; one unreadable NFT is not an empty portfolio.
export async function readPortfolio(adapter: V3Adapter, owner: Address,
  options: { offset?: bigint; block?: Block; signal?: AbortSignal } = {}): Promise<PortfolioPage> {
  const check = () => options.signal?.throwIfAborted();
  const page = await discoverPositions(adapter, owner, { ...options, limit: 5 });
  check();
  const entries: PortfolioEntry[] = [];
  for (const tokenId of page.tokenIds) {
    check();
    try {
      const snapshot = await adapter.snapshotAt(tokenId, page.block);
      check();
      if (snapshot.tokenId !== tokenId || getAddress(snapshot.owner) !== getAddress(owner) ||
          snapshot.block.number !== page.block.number || snapshot.block.hash !== page.block.hash)
        throw new ExitError('DISCOVERY', 'Position does not match the enumerated owner and block');
      entries.push({ tokenId, state: 'ready', snapshot });
    } catch {
      check();
      entries.push({ tokenId, state: 'unavailable' });
    }
  }
  await adapter.rpc.assertBlock(page.block);
  check();
  return { ...page, entries };
}
