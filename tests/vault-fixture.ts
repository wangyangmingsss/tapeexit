import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData,
  encodeFunctionResult, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { tokenAbi } from '../src/config';
import { SparkVaultAdapter } from '../src/core/vault-adapter';
import { SPARK_USDC, vaultAbi } from '../src/core/vault-config';
import { StrictRpc, type Block, type Requester } from '../src/core/rpc';

export const VAULT_OWNER = getAddress('0x1000000000000000000000000000000000000001');
export const VAULT_OTHER = getAddress('0x2000000000000000000000000000000000000002');
export const VAULT_HASH = `0x${'ab'.repeat(32)}` as Hex;
export const vaultBlock = (number: Hex = '0xf'): Block => ({
  number, hash: `0x${BigInt(number).toString(16).padStart(64, '0')}`,
  timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
});
export function vaultFixture() {
  const txBlock = vaultBlock('0x10');
  const identity = { transactionHash: VAULT_HASH, transactionIndex: '0x0',
    blockNumber: txBlock.number, blockHash: txBlock.hash };
  function log(address: Address, topics: Hex[], data: Hex, index: number) {
    return { ...identity, address, topics, data, logIndex: `0x${index.toString(16)}`, removed: false };
  }
  const logs = [
    log(SPARK_USDC.asset, encodeEventTopics({ abi: tokenAbi, eventName: 'Transfer',
      args: { from: SPARK_USDC.vault, to: VAULT_OWNER } }) as Hex[],
    encodeAbiParameters([{ type: 'uint256' }], [255000n]), 0),
    log(SPARK_USDC.vault, encodeEventTopics({ abi: tokenAbi, eventName: 'Transfer',
      args: { from: VAULT_OWNER, to: zeroAddress } }) as Hex[],
    encodeAbiParameters([{ type: 'uint256' }], [250000n]), 1),
    log(SPARK_USDC.vault, encodeEventTopics({ abi: vaultAbi, eventName: 'Withdraw',
      args: { sender: VAULT_OWNER, receiver: VAULT_OWNER, owner: VAULT_OWNER } }) as Hex[],
    encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [255000n, 250000n]), 2),
  ];
  const receipt = { ...identity, from: VAULT_OWNER, to: SPARK_USDC.vault, status: '0x1', logs };
  const tx = { hash: VAULT_HASH, from: VAULT_OWNER, to: SPARK_USDC.vault,
    blockNumber: txBlock.number, blockHash: txBlock.hash, transactionIndex: '0x0', value: '0x0',
    input: encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args: [250000n, VAULT_OWNER, VAULT_OWNER] }) };
  const state = {
    receipt: receipt as typeof receipt | null, tx, maxRedeem: 1_000000n, finality: '0x20' as Hex,
    zero: false, beforeShares: 1_000000n, afterShares: 750000n,
    beforeAssets: 2_000000n, afterAssets: 2_255000n, calls: [] as { method: string; params: unknown[] }[],
  };
  const request: Requester = async (_source, method, params) => {
    state.calls.push({ method, params });
    if (method === 'eth_chainId') return '0xc4';
    if (method === 'eth_blockNumber') return '0x22';
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0] === 'safe' || params[0] === 'finalized' ? state.finality : params[0] as Hex;
      return vaultBlock(tag);
    }
    if (method === 'eth_getTransactionReceipt') return structuredClone(state.receipt);
    if (method === 'eth_getTransactionByHash') return structuredClone(state.tx);
    if (method === 'eth_getStorageAt') return `0x${SPARK_USDC.implementation.slice(2).toLowerCase().padStart(64, '0')}`;
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_gasPrice') return '0x1';
    if (method !== 'eth_call') throw new Error(`Unexpected request ${method}`);
    const call = params[0] as { to: Address; data: Hex };
    const decoded = decodeFunctionData({ abi: [...vaultAbi, ...tokenAbi], data: call.data });
    const pre = params[1] === '0xf';
    let result: unknown;
    if (decoded.functionName === 'balanceOf') {
      if (call.to === SPARK_USDC.asset) result = decoded.args[0] === SPARK_USDC.vault ? 5_000000n :
        pre ? state.beforeAssets : state.afterAssets;
      else result = pre ? state.beforeShares : state.afterShares;
    } else if (decoded.functionName === 'maxRedeem') result = pre ? state.maxRedeem :
      state.maxRedeem > state.afterShares ? state.afterShares : state.maxRedeem;
    else if (decoded.functionName === 'maxWithdraw') result = (pre ? state.beforeShares : state.afterShares) * 102n / 100n;
    else if (decoded.functionName === 'totalAssets') result = 10_000000n;
    else if (decoded.functionName === 'convertToAssets' || decoded.functionName === 'previewRedeem' || decoded.functionName === 'redeem')
      result = state.zero ? 0n : (decoded.args[0] as bigint) * 102n / 100n;
    else if (decoded.functionName === 'asset') result = SPARK_USDC.asset;
    else if (decoded.functionName === 'getImplementation') result = SPARK_USDC.implementation;
    else if (decoded.functionName === 'decimals') result = 6;
    else throw new Error(`Unexpected call ${decoded.functionName}`);
    return encodeFunctionResult({ abi: [...vaultAbi, ...tokenAbi],
      functionName: decoded.functionName, result: result as never });
  };
  const rpc = new StrictRpc([{ url: 'https://first.example', operator: 'a' },
    { url: 'https://second.example', operator: 'b' }], request);
  return { rpc, adapter: new SparkVaultAdapter(rpc), state, request };
}
