import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, keccak256,
  maxUint256, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { tokenAbi } from '../config';
import { ExitError, type Block, type StrictRpc } from './rpc';
import type { ProtocolAdapter, ProtocolDescriptor } from './protocol-adapter';
import { IMPLEMENTATION_SLOT, SPARK_USDC, vaultAbi } from './vault-config';

export interface VaultSnapshot {
  protocolId: 'spark-spusdc';
  vault: Address;
  asset: Address;
  owner: Address;
  shares: bigint;
  assets: bigint;
  maxRedeem: bigint;
  maxWithdraw: bigint;
  totalAssets: bigint;
  liquidAssets: bigint;
  decimals: number;
  block: Block;
}
export interface VaultPlan {
  protocolId: 'spark-spusdc';
  chainId: 196;
  vault: Address;
  owner: Address;
  receiver: Address;
  shares: bigint;
  data: Hex;
  block: Block;
}
export interface VaultPreview {
  assets: bigint;
  shares: bigint;
  remainingShares: bigint;
  gas: bigint;
  gasPrice: bigint;
  block: Block;
}
export function vaultAccount(value: string): Address {
  try {
    const account = getAddress(value);
    if ([zeroAddress, SPARK_USDC.vault, SPARK_USDC.asset].includes(account)) throw new Error();
    return account;
  } catch { throw new ExitError('VAULT_ACCOUNT', 'Enter a valid public wallet address'); }
}
export function vaultPlan(snapshot: VaultSnapshot, shares: bigint): VaultPlan {
  if (snapshot.protocolId !== SPARK_USDC.protocolId || snapshot.vault !== SPARK_USDC.vault ||
      snapshot.asset !== SPARK_USDC.asset)
    throw new ExitError('VAULT_IDENTITY', 'Unsupported vault identity');
  if (typeof shares !== 'bigint' || shares <= 0n || shares > maxUint256 ||
      shares > snapshot.shares || shares > snapshot.maxRedeem)
    throw new ExitError('VAULT_LIMIT', 'Shares exceed the current balance or redeemable limit');
  const owner = vaultAccount(snapshot.owner);
  return { protocolId: SPARK_USDC.protocolId, chainId: 196, vault: SPARK_USDC.vault,
    owner, receiver: owner, shares, block: snapshot.block,
    data: encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args: [shares, owner, owner] }) };
}
/** Only canonical direct self-withdrawals are eligible for recovery. */
export function decodeVaultExit(data: Hex, account: Address) {
  const fail = (): never => { throw new ExitError('VAULT_TRANSACTION', 'Not a supported direct self-withdrawal'); };
  try {
    const decoded = decodeFunctionData({ abi: vaultAbi, data });
    if (decoded.functionName !== 'redeem' && decoded.functionName !== 'withdraw') return fail();
    const [amount, receiver, owner] = decoded.args;
    const expected = vaultAccount(account);
    if (amount <= 0n || getAddress(receiver) !== expected || getAddress(owner) !== expected) return fail();
    const canonical = encodeFunctionData({ abi: vaultAbi, functionName: decoded.functionName, args: decoded.args });
    if (canonical.toLowerCase() !== data.toLowerCase()) return fail();
    return { mode: decoded.functionName, amount, account: expected };
  } catch { return fail(); }
}
export class SparkVaultAdapter implements ProtocolAdapter<Address, VaultSnapshot, VaultPlan, VaultPreview> {
  readonly protocol: ProtocolDescriptor = Object.freeze({
    id: SPARK_USDC.protocolId, name: 'Spark Savings USDC', chainId: 196,
    category: 'vault', actions: Object.freeze(['withdraw'] as const),
  });
  constructor(public readonly rpc: StrictRpc) {}
  async read<T>(abi: Abi, to: Address, name: string, args: readonly unknown[], block: Block): Promise<T> {
    const data = encodeFunctionData({ abi, functionName: name, args });
    const raw = await this.rpc.request<Hex>('eth_call', [{ to, data }, block.number]);
    return decodeFunctionResult({ abi, functionName: name, data: raw }) as T;
  }
  async verifyDeployment(block: Block) {
    await this.rpc.checkChain(196);
    const word = await this.rpc.request<Hex>('eth_getStorageAt', [SPARK_USDC.vault, IMPLEMENTATION_SLOT, block.number]);
    if (!/^0x0{24}[0-9a-f]{40}$/i.test(word) ||
        getAddress(`0x${word.slice(-40)}`) !== SPARK_USDC.implementation)
      throw new ExitError('VAULT_UPGRADE', 'Vault implementation changed; integration must be checked again');
    await Promise.all(([
      [SPARK_USDC.vault, SPARK_USDC.proxyCodeHash],
      [SPARK_USDC.implementation, SPARK_USDC.implementationCodeHash],
      [SPARK_USDC.asset, SPARK_USDC.assetCodeHash],
    ] as const).map(async ([address, expected]) => {
      const code = await this.rpc.request<Hex>('eth_getCode', [address, block.number]);
      if (!/^0x(?:[0-9a-f]{2})+$/i.test(code) || keccak256(code) !== expected)
        throw new ExitError('VAULT_IDENTITY', 'Vault or asset runtime differs from the pinned deployment');
    }));
    const [asset, implementation, vaultDecimals, assetDecimals] = await Promise.all([
      this.read<Address>(vaultAbi, SPARK_USDC.vault, 'asset', [], block),
      this.read<Address>(vaultAbi, SPARK_USDC.vault, 'getImplementation', [], block),
      this.read<number>(vaultAbi, SPARK_USDC.vault, 'decimals', [], block),
      this.read<number>(tokenAbi, SPARK_USDC.asset, 'decimals', [], block),
    ]);
    if (getAddress(asset) !== SPARK_USDC.asset || getAddress(implementation) !== SPARK_USDC.implementation ||
        vaultDecimals !== 6 || assetDecimals !== 6)
      throw new ExitError('VAULT_IDENTITY', 'Vault underlying asset, implementation or precision differs');
  }
  async snapshot(owner: Address): Promise<VaultSnapshot> {
    return this.snapshotAt(owner, await this.rpc.pin());
  }
  async snapshotAt(account: Address, block: Block): Promise<VaultSnapshot> {
    const owner = vaultAccount(account);
    await this.verifyDeployment(block);
    const [shares, maxRedeem, maxWithdraw, totalAssets, liquidAssets] = await Promise.all([
      this.read<bigint>(vaultAbi, SPARK_USDC.vault, 'balanceOf', [owner], block),
      this.read<bigint>(vaultAbi, SPARK_USDC.vault, 'maxRedeem', [owner], block),
      this.read<bigint>(vaultAbi, SPARK_USDC.vault, 'maxWithdraw', [owner], block),
      this.read<bigint>(vaultAbi, SPARK_USDC.vault, 'totalAssets', [], block),
      this.read<bigint>(tokenAbi, SPARK_USDC.asset, 'balanceOf', [SPARK_USDC.vault], block),
    ]);
    const assets = await this.read<bigint>(vaultAbi, SPARK_USDC.vault, 'convertToAssets', [shares], block);
    if (maxRedeem > shares || maxWithdraw > assets || maxWithdraw > liquidAssets)
      throw new ExitError('VAULT_STATE', 'Vault limits are inconsistent');
    await this.rpc.assertBlock(block);
    return { protocolId: 'spark-spusdc', vault: SPARK_USDC.vault, asset: SPARK_USDC.asset,
      owner, shares, assets, maxRedeem, maxWithdraw, totalAssets, liquidAssets, decimals: 6, block };
  }
  async simulate(plan: VaultPlan, block = plan.block): Promise<VaultPreview> {
    const age = BigInt(Math.floor(Date.now() / 1000)) - BigInt(block.timestamp);
    if (age > 300n || age < -30n)
      throw new ExitError('VAULT_STALE', 'Snapshot expired; read the vault again before previewing');
    const exit = decodeVaultExit(plan.data, plan.owner);
    if (plan.protocolId !== SPARK_USDC.protocolId || plan.chainId !== 196 || plan.vault !== SPARK_USDC.vault ||
        plan.receiver !== plan.owner || exit.mode !== 'redeem' || exit.amount !== plan.shares ||
        block.number !== plan.block.number || block.hash !== plan.block.hash)
      throw new ExitError('VAULT_PLAN', 'Vault plan identity differs');
    // Reread the deployment and limits rather than trusting a caller-supplied snapshot.
    const current = await this.snapshotAt(plan.owner, block);
    vaultPlan(current, plan.shares);
    const expected = await this.read<bigint>(vaultAbi, SPARK_USDC.vault, 'previewRedeem', [plan.shares], block);
    const tx = { from: plan.owner, to: plan.vault, data: plan.data, value: '0x0' };
    const raw = await this.rpc.request<Hex>('eth_call', [tx, block.number]);
    const assets = decodeFunctionResult({ abi: vaultAbi, functionName: 'redeem', data: raw });
    if (assets === 0n || assets !== expected)
      throw new ExitError('VAULT_PREVIEW', 'Redeem simulation and preview disagree or produce no assets');
    const [gas, gasPrice] = await Promise.all([this.rpc.estimate(tx), this.rpc.gasPrice()]);
    await this.rpc.assertBlock(block);
    return { assets, shares: plan.shares, remainingShares: current.shares - plan.shares,
      gas: (gas * 120n + 99n) / 100n, gasPrice, block };
  }
}
