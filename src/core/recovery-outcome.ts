import { decodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { DEPLOYMENT, managerAbi, tokenAbi, type Deployment } from '../config';
import { V3Adapter } from './adapter';
import { historicalExitToken, recheckHistory } from './history';
import { ExitError, type StrictRpc } from './rpc';
import { minedTransaction } from './chain-evidence';

/** Block-end state corroborates receipt events; it cannot isolate other activity in that block. */
export async function inspectRecoveryOutcome(rpc: StrictRpc, hash: Hex, tokenId: bigint,
  account: Address, deployment: Deployment = DEPLOYMENT) {
  const checked = await recheckHistory(rpc, {
    tokenId: tokenId.toString(), hash, time: '', environment: 'mainnet', state: 'submitted',
  }, deployment);
  if (checked.state !== 'checked') return { state: checked.state } as const;
  const result = checked.result;
  const tx = minedTransaction(await rpc.request('eth_getTransactionByHash', [hash], minedTransaction));
  if (tx.hash !== hash.toLowerCase() || tx.blockHash !== result.blockHash.toLowerCase() ||
      BigInt(tx.blockNumber) !== BigInt(result.blockNumber) || tx.to !== getAddress(deployment.manager) ||
      BigInt(tx.value) !== 0n || tx.from !== getAddress(account) ||
      historicalExitToken(tx.input, account) !== tokenId)
    throw new ExitError('TRANSACTION_MISMATCH', 'Recovery account or position differs');
  const height = BigInt(result.blockNumber);
  if (!height) throw new ExitError('RPC_INVALID', 'No parent block for recovery comparison');
  const beforeBlock = await rpc.block(`0x${(height - 1n).toString(16)}`);
  const afterBlock = await rpc.block(`0x${height.toString(16)}`);
  if (afterBlock.hash.toLowerCase() !== result.blockHash.toLowerCase())
    throw new ExitError('REORG', 'Recovery receipt block changed');
  const adapter = new V3Adapter(rpc, deployment);
  const before = await adapter.snapshotAt(tokenId, beforeBlock);
  const after = await adapter.snapshotAt(tokenId, afterBlock);
  const identityMatches = before.owner === getAddress(account) && after.owner === getAddress(account) &&
    before.pool === after.pool && before.token0.address === after.token0.address &&
    before.token1.address === after.token1.address && before.tickLower === after.tickLower &&
    before.tickUpper === after.tickUpper && before.fee === after.fee;
  const decoded = decodeFunctionData({ abi: managerAbi, data: tx.input });
  let removed = 0n;
  if (decoded.functionName === 'multicall') {
    const decrease = decodeFunctionData({ abi: managerAbi, data: decoded.args[0][0] });
    if (decrease.functionName !== 'decreaseLiquidity') throw new ExitError('HISTORY', 'Invalid decrease');
    removed = decrease.args[0].liquidity;
  }
  const balances = [];
  for (const [index, asset] of [before.token0, before.token1].entries()) {
    const pre = await adapter.read<bigint>(tokenAbi, asset.address, 'balanceOf', [account], beforeBlock);
    const post = await adapter.read<bigint>(tokenAbi, asset.address, 'balanceOf', [account], afterBlock);
    const received = BigInt(index ? result.amount1 : result.amount0);
    balances.push({ address: asset.address, decimals: asset.decimals, symbol: asset.symbol,
      before: pre.toString(), after: post.toString(), delta: (post - pre).toString(),
      receiptAmount: received.toString(), matches: post - pre === received });
  }
  await rpc.assertBlock(beforeBlock);
  await rpc.assertBlock(afterBlock);
  // Repeat complete receipt/transaction verification after the slower historical state reads.
  const final = await recheckHistory(rpc, {
    tokenId: tokenId.toString(), hash, time: '', environment: 'mainnet', state: 'submitted',
  }, deployment);
  if (final.state !== 'checked' || final.result.blockHash !== result.blockHash ||
      final.result.amount0 !== result.amount0 || final.result.amount1 !== result.amount1 ||
      final.result.state !== result.state)
    throw new ExitError('REORG', 'Recovery evidence changed during verification');
  const finalTx = minedTransaction(await rpc.request('eth_getTransactionByHash', [hash], minedTransaction));
  if (JSON.stringify(finalTx) !== JSON.stringify(tx))
    throw new ExitError('TRANSACTION_MISMATCH', 'Recovery transaction changed during verification');
  await rpc.assertBlock(beforeBlock);
  await rpc.assertBlock(afterBlock);
  const expected = before.liquidity - removed;
  const liquidityMatches = expected >= 0n && after.liquidity === expected;
  const owedCleared = after.owed0 === 0n && after.owed1 === 0n;
  const matches = identityMatches && liquidityMatches && owedCleared &&
    balances.every(asset => asset.matches) && result.state === 'received-checked';
  return {
    state: matches ? 'block-state-matched' : 'block-state-mismatch',
    hash, account: getAddress(account), tokenId: tokenId.toString(), receipt: final.result,
    beforeBlock, afterBlock, identityMatches, balances,
    liquidity: { before: before.liquidity.toString(), removed: removed.toString(),
      expected: expected.toString(), after: after.liquidity.toString(), matches: liquidityMatches },
    owed: { amount0: after.owed0.toString(), amount1: after.owed1.toString(), cleared: owedCleared },
    limitations: 'Balances and position are compared at parent/receipt block ends. Other activity in either ' +
      'block can cause a mismatch or coincidental match. This is corroboration, not transaction-level state ' +
      'attribution, wallet acceptance, independent review or release approval.',
  } as const;
}
