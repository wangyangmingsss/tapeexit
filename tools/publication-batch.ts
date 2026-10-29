import { encodeFunctionData, keccak256, parseAbi, type Hex } from 'viem';
import type { StrictRpc, Block } from '../src/core/rpc';

// Read-only legacy journal verification and fork identity checks. No batch submission.
// Observed deployment pinned to okxlabs/okx-smart-wallet-evm. This is not an audit.
export const BATCH_IMPLEMENTATION = '0xe40ccB2D94975c51bff0C004eFDfd9B3a5796fA4';
export const BATCH_CODE_HASH = '0xef2c339869b7f98f617866a7d78423c05e5f46795cce5dee5c9d3b91ca8733b0';
export const BATCH_CONSENT = 'ATOMIC_BATCH_WALLET_FEES_AND_POSSIBLE_ACCOUNT_UPGRADE';
const abi = parseAbi([
  'function execute((address target,uint256 value,bytes data)[] calls)',
]);
export const delegation = `0xef0100${BATCH_IMPLEMENTATION.slice(2).toLowerCase()}`;
export function batchData(calls: { to: string; data: Hex }[]) {
  return encodeFunctionData({ abi, functionName: 'execute',
    args: [calls.map(c => ({ target: c.to as Hex, value: 0n, data: c.data }))] });
}
export async function checkBatchCode(rpc: StrictRpc, publisher: string, block: Block, allowEmpty: boolean) {
  const [account, code] = await Promise.all([
    rpc.request<Hex>('eth_getCode', [publisher, block.number]),
    rpc.request<Hex>('eth_getCode', [BATCH_IMPLEMENTATION, block.number]),
  ]);
  if (keccak256(code) !== BATCH_CODE_HASH) throw new Error('Batch implementation code pin mismatch');
  if (account.toLowerCase() !== delegation && !(allowEmpty && account === '0x'))
    throw new Error('Wallet selected an unsupported account implementation; batch stopped');
  return account === '0x';
}
