import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, zeroAddress,
  type Abi, type Address, type Hex } from 'viem';
import { DEPLOYMENT, managerAbi, factoryAbi, poolAbi, tokenAbi, type Deployment } from '../config';
import { StrictRpc, ExitError, type Block } from './rpc';
import type { Asset, Snapshot, Plan, Preview } from './protocol';
import { loadPlan } from './plan-loader';

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
    return this.snapshotAt(tokenId, block);
  }
  async snapshotAt(tokenId: bigint, block: Block): Promise<Snapshot> {
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
    const { validatePlan } = await loadPlan();
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
