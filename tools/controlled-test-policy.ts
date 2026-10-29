import {
  decodeFunctionData, encodeFunctionData, getAddress, keccak256, parseAbi, toHex,
  type Hex,
} from 'viem';
import { DEPLOYMENT, MANAGER, managerAbi } from '../src/config';
import { V3Adapter } from '../src/core/adapter';
import { minimumAmounts, type Snapshot } from '../src/core/protocol';
import { decodeStorageAddress, IMPL_SLOT } from './proxy-identity-core';
import { inspectForkOwner } from './fork-owner';
import { TEST_POLICY } from './controlled-test-scope';

// Explicit one-position user test scope. None of these observations approve an asset.
export { TEST_POLICY };
const usdcImplementationSlot = keccak256(toHex('org.zeppelinos.proxy.implementation'));
const usdcAdminSlot = keccak256(toHex('org.zeppelinos.proxy.admin'));
const riskAbi = parseAbi([
  'function isBlocked(address) view returns (bool)',
  'function isBlacklisted(address) view returns (bool)',
  'function paused() view returns (bool)',
]);
export function assertTestPosition(s: Snapshot) {
  const p = TEST_POLICY;
  if (s.tokenId.toString() !== p.tokenId || s.owner !== p.account || s.pool !== p.pool ||
      s.token0.address !== p.token0 || s.token1.address !== p.token1 || s.fee !== 100 ||
      s.token0.decimals !== 6 || s.token1.decimals !== 6 ||
      s.tickLower !== -887272 || s.tickUpper !== 887272 ||
      s.liquidity.toString() !== p.baselineLiquidity || s.owed0 || s.owed1)
    throw new Error('Test position changed or was already used; no further exit is authorized');
}
export async function checkTestAssets(adapter: V3Adapter, snapshot: Snapshot) {
  const { rpc } = adapter, block = snapshot.block, p = TEST_POLICY;
  assertTestPosition(snapshot);
  await inspectForkOwner(rpc, p.account, block);
  for (const [address, expected] of [
    [p.token0, '0x4d9be648c5bf39973670d9f8b481d5d0b971e6a2db2deccc6b98cde21c5dd83e'],
    [getAddress('0x1EC7df9e74bE05cb5A456ACa2DC1AC2CeC9AB6A3'), '0x61466328a9d17e782f4a37d32db189f981ce32e45de6a4668c3f7bb1cd8d49ae'],
    [p.token1, '0xa259d230afe44e97f1500ce5c06cd2e5bdafb129f25c104d8716470cb4fff0be'],
    [getAddress('0x908CB63Cded85Ee69525E2F95F7f38Da25aE0245'), '0x45aaf25df342cc872fb33fca42e4143c905c27dbd2aa6d922cafe8ceb2c834d6'],
  ] as const) {
    const code = await rpc.request<Hex>('eth_getCode', [address, block.number]);
    if (!code || code === '0x' || keccak256(code) !== expected)
      throw new Error('Observed token or implementation code changed; test stopped');
  }
  for (const [token, slot, expected] of [
    [p.token0, IMPL_SLOT, getAddress('0x1EC7df9e74bE05cb5A456ACa2DC1AC2CeC9AB6A3')],
    [p.token1, usdcImplementationSlot, getAddress('0x908CB63Cded85Ee69525E2F95F7f38Da25aE0245')],
    [p.token1, usdcAdminSlot, getAddress('0x86a2b15f6EF67AF32a6b7C43903cdECb1f540ec1')],
  ] as const) {
    if (decodeStorageAddress(await rpc.request('eth_getStorageAt', [token, slot, block.number])) !== expected)
      throw new Error('Token proxy pointer changed; test stopped');
  }
  if (await adapter.read<boolean>(riskAbi, p.token1, 'paused', [], block))
    throw new Error('USDC is paused');
  for (const address of [p.account, p.pool, MANAGER]) {
    if (await adapter.read<boolean>(riskAbi, p.token0, 'isBlocked', [address], block) ||
        await adapter.read<boolean>(riskAbi, p.token1, 'isBlacklisted', [address], block))
      throw new Error('A test participant is blocked by the issuer');
  }
  await rpc.assertBlock(block);
}
export function controlledTestData(s: Snapshot, deadline = BigInt(s.block.timestamp) + 300n) {
  assertTestPosition(s);
  const p = TEST_POLICY, liquidity = BigInt(p.removeLiquidity);
  const minimums = minimumAmounts(s, liquidity, p.slippageBps, DEPLOYMENT);
  if (minimums.some(n => n <= 0n || n > BigInt(p.maximumCollectionPerToken)))
    throw new Error('Small-test principal minima outside the fixed token budget');
  const data = encodeFunctionData({ abi: managerAbi, functionName: 'multicall', args: [[
    encodeFunctionData({ abi: managerAbi, functionName: 'decreaseLiquidity', args: [{
      tokenId: s.tokenId, liquidity, amount0Min: minimums[0], amount1Min: minimums[1], deadline,
    }] }),
    encodeFunctionData({ abi: managerAbi, functionName: 'collect', args: [{
      tokenId: s.tokenId, recipient: p.account, amount0Max: BigInt(p.maximumCollectionPerToken),
      amount1Max: BigInt(p.maximumCollectionPerToken),
    }] }),
  ]] });
  return { data, minimums: minimums.map(String), deadline: deadline.toString() };
}
export function validateTestData(data: Hex) {
  const outer = decodeFunctionData({ abi: managerAbi, data }), p = TEST_POLICY;
  if (outer.functionName !== 'multicall' || outer.args[0].length !== 2) throw new Error('Invalid test actions');
  const decrease = decodeFunctionData({ abi: managerAbi, data: outer.args[0][0] });
  const collect = decodeFunctionData({ abi: managerAbi, data: outer.args[0][1] });
  if (decrease.functionName !== 'decreaseLiquidity' || collect.functionName !== 'collect')
    throw new Error('Invalid test actions');
  const d = decrease.args[0], c = collect.args[0], cap = BigInt(p.maximumCollectionPerToken);
  if (d.tokenId.toString() !== p.tokenId || d.liquidity.toString() !== p.removeLiquidity ||
      c.tokenId !== d.tokenId || c.recipient !== p.account || c.amount0Max !== cap || c.amount1Max !== cap ||
      d.amount0Min <= 0n || d.amount1Min <= 0n || d.amount0Min > cap || d.amount1Min > cap)
    throw new Error('Test transaction exceeds the exact position, recipient or token budget');
  return d;
}
