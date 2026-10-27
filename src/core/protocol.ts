import { Token, Percent } from '@uniswap/sdk-core';
import { Pool, Position } from '@uniswap/v3-sdk';
import {
  decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData,
  getAddress, keccak256, maxUint128, parseAbiParameters, zeroAddress,
  type Address, type Hex, type Abi,
} from 'viem';
import { DEPLOYMENT, managerAbi, factoryAbi, poolAbi, tokenAbi, RELEASE, type Deployment } from '../config';
import { StrictRpc, ExitError, type Block } from './rpc';

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
export function parseTokenId(input: string): bigint {
  if (!/^(0|[1-9]\d{0,77})$/.test(input)) throw new ExitError('INPUT', 'Invalid token ID');
  const id = BigInt(input);
  if (id >= 2n ** 256n) throw new ExitError('INPUT', 'Token ID exceeds uint256');
  return id;
}
export class V3Adapter {
  constructor(public rpc: StrictRpc, public deployment: Deployment = DEPLOYMENT,
    private supported: readonly Address[] = []) {}
  async read<T>(abi: Abi, to: Address, name: string, args: readonly unknown[], block: Block): Promise<T> {
    const data = encodeFunctionData({ abi, functionName: name, args });
    const result = await this.rpc.request<Hex>('eth_call', [{ to, data }, block.number]);
    return decodeFunctionResult({ abi, functionName: name, data: result }) as T;
  }
  async verifyDeployment(block: Block) {
    await this.rpc.checkChain(this.deployment.chainId);
    for (const [address, expectedHash] of [
      [this.deployment.manager, this.deployment.managerCodeHash],
      [this.deployment.factory, this.deployment.factoryCodeHash],
    ] as const) {
      const code = await this.rpc.request<Hex>('eth_getCode', [address, block.number]);
      if (!code || code === '0x') throw new ExitError('DEPLOYMENT', 'Contract code missing');
      if (expectedHash && keccak256(code) !== expectedHash)
        throw new ExitError('DEPLOYMENT', 'Contract bytecode changed from the reviewed configuration');
    }
    const factory = await this.read<Address>(managerAbi, this.deployment.manager, 'factory', [], block);
    const wrapped = await this.read<Address>(managerAbi, this.deployment.manager, 'WETH9', [], block);
    if (getAddress(factory) !== getAddress(this.deployment.factory) ||
        getAddress(wrapped) !== getAddress(this.deployment.wrappedNative))
      throw new ExitError('DEPLOYMENT', 'Manager configuration mismatch');
  }
  async asset(address: Address, block: Block): Promise<Asset> {
    const verified = this.supported.some(a => a.toLowerCase() === address.toLowerCase());
    const decimals = Number(await this.read<number>(tokenAbi, address, 'decimals', [], block));
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
      throw new ExitError('UNSUPPORTED', 'Unsupported token precision');
    let symbol = 'TOKEN';
    try { symbol = String(await this.read<string>(tokenAbi, address, 'symbol', [], block)).slice(0, 24); } catch { /* Address remains the identity. */ }
    return { address: getAddress(address), decimals, symbol, verified };
  }
  async snapshot(tokenId: bigint): Promise<Snapshot> {
    const block = await this.rpc.pin();
    await this.verifyDeployment(block);
    const [owner, p] = await Promise.all([
      this.read<Address>(managerAbi, this.deployment.manager, 'ownerOf', [tokenId], block),
      this.read<readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]>(
        managerAbi, this.deployment.manager, 'positions', [tokenId], block),
    ]);
    const pool = await this.read<Address>(factoryAbi, this.deployment.factory, 'getPool', [p[2], p[3], p[4]], block);
    if (pool === zeroAddress) throw new ExitError('DEPLOYMENT', 'Pool does not exist');
    const [t0, t1, fee, factory, slot, poolLiquidity, token0, token1] = await Promise.all([
      this.read<Address>(poolAbi, pool, 'token0', [], block),
      this.read<Address>(poolAbi, pool, 'token1', [], block),
      this.read<number>(poolAbi, pool, 'fee', [], block),
      this.read<Address>(poolAbi, pool, 'factory', [], block),
      this.read<readonly [bigint, number, number, number, number, number, boolean]>(poolAbi, pool, 'slot0', [], block),
      this.read<bigint>(poolAbi, pool, 'liquidity', [], block),
      this.asset(p[2], block), this.asset(p[3], block),
    ]);
    if (getAddress(t0) !== getAddress(p[2]) || getAddress(t1) !== getAddress(p[3]) ||
        fee !== p[4] || getAddress(factory) !== getAddress(this.deployment.factory))
      throw new ExitError('DEPLOYMENT', 'Pool identity mismatch');
    if (!slot[6]) throw new ExitError('POOL_LOCKED', 'Pool is locked');
    await this.rpc.assertBlock(block);
    return { tokenId, owner: getAddress(owner), pool: getAddress(pool), token0, token1,
      fee: p[4], tickLower: p[5], tickUpper: p[6], liquidity: p[7], owed0: p[10], owed1: p[11],
      sqrtPriceX96: slot[0], tick: slot[1], poolLiquidity, block };
  }
  async simulate(plan: Plan, block = plan.snapshot.block): Promise<Preview> {
    validatePlan(plan, this.deployment);
    const tx = { from: plan.account, to: plan.manager, data: plan.data, value: '0x0' };
    const data = await this.rpc.request<Hex>('eth_call', [tx, block.number]);
    let amounts: readonly [bigint, bigint];
    if (plan.mode === 'collect-only') {
      amounts = decodeFunctionResult({ abi: managerAbi, functionName: 'collect', data });
    } else {
      const result = decodeFunctionResult({ abi: managerAbi, functionName: 'multicall', data });
      amounts = decodeFunctionResult({ abi: managerAbi, functionName: 'collect', data: result[1] });
    }
    if (amounts[0] === 0n && amounts[1] === 0n) throw new ExitError('EMPTY', 'No assets to collect');
    const [gas, gasPrice] = await Promise.all([
      this.rpc.estimate(tx), this.rpc.gasPrice(),
    ]);
    await this.rpc.assertBlock(block);
    return { amount0: amounts[0], amount1: amounts[1], gas: (gas * 120n + 99n) / 100n, gasPrice };
  }
}
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
function minimumAmounts(s: Snapshot, liquidity: bigint, slippageBps: number, deployment: Deployment): [bigint, bigint] {
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
