import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error The pinned compiler has no TypeScript declarations.
import solc from 'solc';
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { startLocalEvm } from '../tools/local-evm';
import { inspectAssets } from '../tools/operations-core';
import { compareAssetIdentities } from '../tools/asset-identity-core';
import { ADMIN_SLOT, BEACON_SLOT, IMPL_SLOT } from '../tools/proxy-identity-core';

const token: Address = '0x1000000000000000000000000000000000000001';
const beacon: Address = '0x2000000000000000000000000000000000000002';
const first: Address = '0x3000000000000000000000000000000000000003';
const second: Address = '0x4000000000000000000000000000000000000004';
const publisher: Address = '0x5000000000000000000000000000000000000005';
// Standard-slot observation fixture; no claim about real token authorization/governance.
const source = `pragma solidity =0.7.6;
contract ObservationFixture {
  function set(bytes32 slot,address value) external { assembly { sstore(slot,value) } }
  function implementation() external view returns(address value) {
    bytes32 slot=bytes32(uint256(123)); assembly { value := sload(slot) }
  }
  function decimals() external pure returns(uint8) { return 6; }
  function symbol() external pure returns(string memory) { return "FIXTURE"; }
}`;
const abi = parseAbi(['function set(bytes32 slot,address value)']);
describe('proxy upgrades observed on disposable EVM', () => {
  let evm: Awaited<ReturnType<typeof startLocalEvm>>, rpc: StrictRpc, checkpoint: unknown;
  beforeAll(async () => {
    evm = await startLocalEvm();
    const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity',
      sources: { 'Fixture.sol': { content: source } },
      settings: { outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } } } })));
    const code = `0x${compiled.contracts['Fixture.sol'].ObservationFixture.evm.deployedBytecode.object}`;
    for (const address of [token, beacon]) await evm.request('anvil_setCode', [address, code]);
    await evm.request('anvil_setCode', [first, '0x6000']);
    await evm.request('anvil_setCode', [second, '0x6001']);
    await evm.request('anvil_setBalance', [publisher, '0x8ac7230489e80000']);
    await evm.request('anvil_impersonateAccount', [publisher]);
    rpc = new StrictRpc([{ url: 'http://127.0.0.1', operator: 'same-evm-a' },
      { url: 'http://127.0.0.1', operator: 'same-evm-b' }], (_s, m, p) => evm.request(m, p));
  });
  beforeEach(async () => { checkpoint = await evm.request('evm_snapshot'); });
  afterEach(async () => { await evm?.request('evm_revert', [checkpoint]); });
  afterAll(async () => { await evm?.close(); });
  async function set(address: Address, slot: Hex, value: Address) {
    const hash = await evm.request('eth_sendTransaction', [{ from: publisher, to: address,
      data: encodeFunctionData({ abi, functionName: 'set', args: [slot, value] }), gas: '0x186a0' }]);
    await evm.request('evm_mine'); await evm.request('evm_mine'); await evm.request('evm_mine');
    expect(await evm.request('eth_getTransactionReceipt', [hash])).toMatchObject({ status: '0x1' });
  }
  it('detects actual implementation-slot changes with unchanged root code', async () => {
    await set(token, IMPL_SLOT, first);
    const baseline = await inspectAssets(rpc, [token]);
    await set(token, IMPL_SLOT, second);
    const current = await inspectAssets(rpc, [token]);
    expect(current.assets[0].codeHash).toBe(baseline.assets[0].codeHash);
    expect(compareAssetIdentities(baseline, current).status).toBe('ASSET_IDENTITY_CHANGED');
  });
  it('detects a beacon implementation changed by an actual local transaction', async () => {
    await set(token, BEACON_SLOT, beacon);
    const slot = `0x${(123n).toString(16).padStart(64, '0')}` as Hex;
    await set(beacon, slot, first);
    const baseline = await inspectAssets(rpc, [token]);
    await set(beacon, slot, second);
    const current = await inspectAssets(rpc, [token]);
    expect(current.assets[0].proxy.edges).toContainEqual({ from: beacon, to: second, kind: 'beacon-return' });
    expect(compareAssetIdentities(baseline, current).status).toBe('ASSET_IDENTITY_CHANGED');
  });
  it('detects changed admin storage and rejects an implementation with no runtime code', async () => {
    await set(token, IMPL_SLOT, first);
    const baseline = await inspectAssets(rpc, [token]);
    await set(token, ADMIN_SLOT, publisher);
    expect(compareAssetIdentities(baseline, await inspectAssets(rpc, [token])).status).toBe('ASSET_IDENTITY_CHANGED');
    await set(token, IMPL_SLOT, publisher);
    await expect(inspectAssets(rpc, [token])).rejects.toThrow('missing');
  });
});
