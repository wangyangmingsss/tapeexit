import { Token, Percent } from '@uniswap/sdk-core';
import { Pool, Position } from '@uniswap/v3-sdk';
import {
  decodeFunctionData, encodeAbiParameters, encodeFunctionData,
  getAddress, keccak256, maxUint128, parseAbiParameters,
  type Address, type Hex,
} from 'viem';
import { DEPLOYMENT, managerAbi, RELEASE, type Deployment } from '../config';
import { ExitError, type Block } from './rpc';
export { V3Adapter } from './adapter';
export { parseTokenId } from './token-id';

export interface Asset { address: Address; symbol: string; decimals: number; verified: boolean }
export interface Snapshot {
  tokenId: bigint; owner: Address; pool: Address; token0: Asset; token1: Asset;
  fee: number; tickLower: number; tickUpper: number; liquidity: bigint;
  sqrtPriceX96: bigint; tick: number; poolLiquidity: bigint;
  owed0: bigint; owed1: bigint; block: Block;
}
export interface Plan {
  releaseId: string; snapshot: Snapshot; chainId: number; account: Address;
  manager: Address; tokenId: bigint; mode: 'decrease-and-collect' | 'collect-only';
  liquidity: bigint; amount0Min: bigint; amount1Min: bigint; deadline: bigint | null;
  slippageBps: number; recipient: Address; value: 0n; data: Hex; hash: Hex; createdAt: number;
}
export interface Preview { amount0: bigint; amount1: bigint; gas: bigint; gasPrice: bigint }
export function makePlan(s: Snapshot, account: Address, bps: number, slippageBps: number,
  collectOnly = false, deployment = DEPLOYMENT): Plan {
  if (getAddress(account) !== s.owner) throw new ExitError('OWNER', 'Only the direct NFT owner can exit');
  if (!s.token0.verified || !s.token1.verified) throw new ExitError('UNSUPPORTED', 'Assets are not approved for this release');
  if (!Number.isInteger(bps) || bps < 1 || bps > 10000 ||
      !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 300)
    throw new ExitError('INPUT', 'Invalid percentage or slippage');
  const liquidity = collectOnly ? 0n : bps === 10000 ? s.liquidity : s.liquidity * BigInt(bps) / 10000n;
  if (!collectOnly && liquidity === 0n) throw new ExitError('EMPTY', 'Liquidity rounds to zero');
  const [amount0Min, amount1Min] = collectOnly ? [0n, 0n] : minimumAmounts(s, liquidity, slippageBps, deployment);
  if (!collectOnly && !amount0Min && !amount1Min) throw new ExitError('DUST', 'Minimum output rounds to zero');
  const deadline = collectOnly ? null : BigInt(s.block.timestamp) + 300n;
  const collect = encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
    tokenId: s.tokenId, recipient: account, amount0Max: maxUint128, amount1Max: maxUint128,
  }] });
  const data = collectOnly ? collect : encodeFunctionData({
    abi: managerAbi, functionName: 'multicall', args: [[
      encodeFunctionData({ abi: managerAbi, functionName: 'decreaseLiquidity', args: [{
        tokenId: s.tokenId, liquidity, amount0Min, amount1Min, deadline: deadline!,
      }] }), collect,
    ]],
  });
  const hash = planHash(deployment.chainId, account, deployment.manager, data);
  const frozenSnapshot = Object.freeze({ ...s, token0: Object.freeze({ ...s.token0 }),
    token1: Object.freeze({ ...s.token1 }), block: Object.freeze({ ...s.block }) });
  const plan: Plan = { releaseId: RELEASE, snapshot: frozenSnapshot, chainId: deployment.chainId,
    account, manager: deployment.manager, tokenId: s.tokenId, mode: collectOnly ? 'collect-only' : 'decrease-and-collect',
    liquidity, amount0Min, amount1Min, deadline, slippageBps, recipient: account,
    value: 0n, data, hash, createdAt: Date.now() };
  validatePlan(plan, deployment);
  return Object.freeze(plan);
}
export function minimumAmounts(s: Snapshot, liquidity: bigint, slippageBps: number, deployment: Deployment): [bigint, bigint] {
  const pool = new Pool(
    new Token(deployment.chainId, s.token0.address, s.token0.decimals),
    new Token(deployment.chainId, s.token1.address, s.token1.decimals),
    s.fee, s.sqrtPriceX96.toString(), s.poolLiquidity.toString(), s.tick,
  );
  const position = new Position({ pool, liquidity: liquidity.toString(), tickLower: s.tickLower, tickUpper: s.tickUpper });
  const amounts = position.burnAmountsWithSlippage(new Percent(slippageBps, 10000));
  return [BigInt(amounts.amount0.toString()), BigInt(amounts.amount1.toString())];
}
function planHash(chain: number, from: Address, to: Address, data: Hex) {
  return keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,address,bytes'), [BigInt(chain), from, to, data]));
}
export function validatePlan(p: Plan, deployment = DEPLOYMENT) {
  const fail = () => { throw new ExitError('PLAN', 'Transaction plan integrity check failed'); };
  if (p.chainId !== deployment.chainId || p.manager !== deployment.manager || p.value !== 0n ||
      p.releaseId !== RELEASE || !['decrease-and-collect', 'collect-only'].includes(p.mode) ||
      !p.snapshot.token0.verified || !p.snapshot.token1.verified ||
      !Number.isInteger(p.slippageBps) || p.slippageBps < 1 || p.slippageBps > 300 ||
      !Number.isSafeInteger(p.createdAt) || p.createdAt > Date.now() + 1000 ||
      p.recipient !== p.account || p.tokenId !== p.snapshot.tokenId ||
      getAddress(p.account) !== p.snapshot.owner || p.liquidity < 0n || p.liquidity > p.snapshot.liquidity ||
      p.hash !== planHash(p.chainId, p.account, p.manager, p.data)) fail();
  const decoded = decodeFunctionData({ abi: managerAbi, data: p.data });
  let collectData = p.data;
  if (p.mode === 'decrease-and-collect') {
    const [min0, min1] = minimumAmounts(p.snapshot, p.liquidity, p.slippageBps, deployment);
    if ((!min0 && !min1) || min0 !== p.amount0Min || min1 !== p.amount1Min ||
        p.deadline !== BigInt(p.snapshot.block.timestamp) + 300n) return fail();
    if (decoded.functionName !== 'multicall') return fail();
    const calls = decoded.args[0];
    if (calls.length !== 2) return fail();
    const decrease = decodeFunctionData({ abi: managerAbi, data: calls[0] });
    if (decrease.functionName !== 'decreaseLiquidity') return fail();
    const d = decrease.args[0];
    if (d.tokenId !== p.tokenId || d.liquidity !== p.liquidity || d.liquidity === 0n ||
        d.amount0Min !== p.amount0Min || d.amount1Min !== p.amount1Min ||
        d.deadline !== p.deadline || !p.deadline) fail();
    collectData = calls[1];
  } else if (p.liquidity !== 0n || p.deadline !== null || p.amount0Min !== 0n || p.amount1Min !== 0n) fail();
  const collect = decodeFunctionData({ abi: managerAbi, data: collectData });
  if (collect.functionName !== 'collect') return fail();
  const c = collect.args[0];
  if (c.tokenId !== p.tokenId || getAddress(c.recipient) !== getAddress(p.account) ||
      c.amount0Max !== maxUint128 || c.amount1Max !== maxUint128) fail();
}
