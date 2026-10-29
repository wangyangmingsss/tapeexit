import type { Hex } from 'viem';
import type { Block, StrictRpc } from '../src/core/rpc';
import { BATCH_CODE_HASH, BATCH_IMPLEMENTATION, checkBatchCode, delegation } from './publication-batch';

// This recognizes senders for local impersonation, not wallet authorization.
export async function inspectForkOwner(rpc: StrictRpc, owner: string, block: Block) {
  const code = await rpc.request<Hex>('eth_getCode', [owner, block.number]);
  if (code === '0x') return { kind: 'EMPTY_CODE_EOA', code } as const;
  if (typeof code !== 'string' || code.toLowerCase() !== delegation)
    throw new Error('Unsupported fork owner code; arbitrary contract wallets are not impersonated');
  await checkBatchCode(rpc, owner, block, false);
  return { kind: 'PINNED_EIP7702_DELEGATION', code,
    implementation: BATCH_IMPLEMENTATION, implementationCodeHash: BATCH_CODE_HASH } as const;
}
