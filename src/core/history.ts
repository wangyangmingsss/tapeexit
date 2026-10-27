import { decodeFunctionData, getAddress, maxUint128, type Address, type Hex } from 'viem';
import { DEPLOYMENT, managerAbi, type Deployment } from '../config';
import { parseTokenId, V3Adapter } from './protocol';
import { inspectReceipt, type Result } from './receipt';
import { ExitError, type StrictRpc } from './rpc';
import type { HistoryItem } from './storage';

export type HistoryVerification =
  | { state: 'pending' }
  | { state: 'reverted'; blockNumber: string }
  | { state: 'checked'; result: Result };

export function historicalExitToken(data: Hex, account: Address): bigint {
  const fail = () => { throw new ExitError('HISTORY', 'Transaction is not a supported direct exit'); };
  let collectData = data;
  let decreaseId: bigint | undefined;
  const outer = decodeFunctionData({ abi: managerAbi, data });
  if (outer.functionName === 'multicall') {
    const calls = outer.args[0];
    if (calls.length !== 2) return fail();
    const decrease = decodeFunctionData({ abi: managerAbi, data: calls[0] });
    if (decrease.functionName !== 'decreaseLiquidity' || decrease.args[0].liquidity === 0n) return fail();
    decreaseId = decrease.args[0].tokenId;
    collectData = calls[1];
  } else if (outer.functionName !== 'collect') return fail();
  const decoded = decodeFunctionData({ abi: managerAbi, data: collectData });
  if (decoded.functionName !== 'collect') return fail();
  const collect = decoded.args[0];
  if (getAddress(collect.recipient) !== getAddress(account) ||
      collect.amount0Max !== maxUint128 || collect.amount1Max !== maxUint128 ||
      (decreaseId !== undefined && decreaseId !== collect.tokenId)) return fail();
  return collect.tokenId;
}

export async function recheckHistory(rpc: StrictRpc, item: HistoryItem, deployment: Deployment = DEPLOYMENT):
Promise<HistoryVerification> {
  if (item.environment !== 'mainnet' || !/^0x[\da-f]{64}$/i.test(item.hash))
    throw new ExitError('HISTORY', 'Only a valid mainnet transaction hash can be rechecked');
  const tokenId = parseTokenId(item.tokenId);
  await rpc.checkChain(deployment.chainId);
  const hash = item.hash as Hex;
  const receipt = await rpc.request<{ status: Hex; blockNumber: Hex; blockHash: Hex; transactionHash: Hex; from: Address; to: Address } | null>(
    'eth_getTransactionReceipt', [hash], value => value ? {
      status: value.status, blockNumber: value.blockNumber, blockHash: value.blockHash,
      transactionHash: value.transactionHash, from: value.from, to: value.to,
    } : null);
  if (!receipt) return { state: 'pending' };
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || getAddress(receipt.to) !== getAddress(deployment.manager))
    throw new ExitError('HISTORY', 'Receipt does not match the configured manager');
  const block = await rpc.block(receipt.blockNumber);
  if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new ExitError('REORG', 'Receipt block changed');
  const tx = await rpc.request<{ from: Address; to: Address; input: Hex; value: Hex } | null>(
    'eth_getTransactionByHash', [hash], value => value ? {
      from: value.from, to: value.to, input: value.input, value: value.value,
    } : null);
  if (!tx || getAddress(tx.to) !== getAddress(deployment.manager) ||
      getAddress(tx.from) !== getAddress(receipt.from) || BigInt(tx.value) !== 0n ||
      historicalExitToken(tx.input, tx.from) !== tokenId)
    throw new ExitError('HISTORY', 'Stored position hint does not match the actual direct exit');
  if (BigInt(receipt.status) === 0n) {
    await rpc.assertBlock(block);
    return { state: 'reverted', blockNumber: BigInt(block.number).toString() };
  }
  if (BigInt(receipt.status) !== 1n) throw new ExitError('HISTORY', 'Invalid transaction status');
  const snapshot = await new V3Adapter(rpc, deployment).snapshotAt(tokenId, block);
  const result = await inspectReceipt(rpc, hash, {
    account: getAddress(tx.from), manager: deployment.manager, data: tx.input, snapshot,
  });
  await rpc.assertBlock(block);
  if (!result) return { state: 'pending' };
  if (result.blockHash.toLowerCase() !== block.hash.toLowerCase())
    throw new ExitError('REORG', 'Receipt moved during historical verification');
  return { state: 'checked', result };
}
