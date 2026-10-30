import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, zeroAddress, type Hex } from 'viem';
import { SparkVaultAdapter, decodeVaultExit, vaultAccount, vaultPlan } from '../src/core/vault-adapter';
import { SPARK_USDC, vaultAbi } from '../src/core/vault-config';
import { StrictRpc } from '../src/core/rpc';
import { VAULT_OTHER, VAULT_OWNER, vaultBlock, vaultFixture } from './vault-fixture';

afterEach(() => vi.restoreAllMocks());
describe('Spark vault reads and simulation after deployment verification', () => {
  beforeEach(() => vi.spyOn(SparkVaultAdapter.prototype, 'verifyDeployment').mockResolvedValue());
  it('uses the shared protocol boundary without NFT or two-token assumptions', async () => {
    const { adapter, state } = vaultFixture();
    expect(adapter.protocol.category).toBe('vault');
    const snapshot = await adapter.snapshotAt(VAULT_OWNER, vaultBlock());
    expect(snapshot.shares).toBe(1_000000n);
    expect(snapshot.assets).toBe(1_020000n);
    expect(snapshot.maxRedeem).toBe(1_000000n);
    const preview = await adapter.simulate(vaultPlan(snapshot, 250000n));
    expect(preview).toMatchObject({ assets: 255000n, shares: 250000n, remainingShares: 750000n, gas: 120000n });
    expect(state.calls.some(call => /send|sign|approve/i.test(call.method))).toBe(false);
    expect(state.calls.filter(call => call.method === 'eth_call').every(call => call.params[1] === '0xf')).toBe(true);
  });
  it('returns a successful zero position distinctly from RPC failure', async () => {
    const { adapter, state } = vaultFixture();
    state.beforeShares = 0n; state.maxRedeem = 0n;
    expect((await adapter.snapshotAt(VAULT_OWNER, vaultBlock())).shares).toBe(0n);
    state.maxRedeem = 1n;
    await expect(adapter.snapshotAt(VAULT_OWNER, vaultBlock())).rejects.toThrow('limits');
  });
  it.each([0n, -1n, 1_000001n, 2n ** 256n])('rejects invalid redeem shares %s', async shares => {
    const { adapter } = vaultFixture();
    const snapshot = await adapter.snapshotAt(VAULT_OWNER, vaultBlock());
    expect(() => vaultPlan(snapshot, shares)).toThrow();
  });
  it('rereads current limits even if the supplied snapshot permits redemption', async () => {
    const { adapter, state } = vaultFixture();
    const snapshot = await adapter.snapshotAt(VAULT_OWNER, vaultBlock());
    const plan = vaultPlan(snapshot, 250000n);
    state.maxRedeem = 0n;
    await expect(adapter.simulate(plan)).rejects.toThrow('limit');
  });
  it('rejects zero output and distinguishes preview from successful withdrawal', async () => {
    const { adapter, state } = vaultFixture();
    const snapshot = await adapter.snapshotAt(VAULT_OWNER, vaultBlock());
    const plan = vaultPlan(snapshot, 250000n);
    state.zero = true;
    await expect(adapter.simulate(plan)).rejects.toThrow();
  });
  it('requires a fresh snapshot before previewing', async () => {
    const { adapter } = vaultFixture();
    const snapshot = await adapter.snapshotAt(VAULT_OWNER, vaultBlock());
    const plan = vaultPlan(snapshot, 250000n);
    plan.block = { ...plan.block, timestamp: '0x1' };
    await expect(adapter.simulate(plan)).rejects.toThrow('expired');
  });
  it.each(['vault', 'receiver', 'chainId', 'protocolId', 'data', 'block'] as const)('rejects modified %s in the plan', async key => {
    const { adapter } = vaultFixture();
    const snapshot = await adapter.snapshotAt(VAULT_OWNER, vaultBlock());
    const plan = vaultPlan(snapshot, 250000n);
    const changes = { vault: VAULT_OTHER, receiver: VAULT_OTHER, chainId: 1, protocolId: 'other',
      data: `${plan.data}00`, block: { ...plan.block, hash: `0x${'ff'.repeat(32)}` } };
    await expect(adapter.simulate({ ...plan, [key]: changes[key] } as typeof plan)).rejects.toThrow();
  });
});
it('fails closed when the implementation slot changes', async () => {
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }],
    async (_source, method) => method === 'eth_chainId' ? '0xc4' : `0x${'0'.repeat(64)}`);
  await expect(new SparkVaultAdapter(rpc).verifyDeployment(vaultBlock())).rejects.toThrow('implementation changed');
});
it('fails closed on an unpinned runtime even if the slot points to the correct implementation', async () => {
  const { adapter } = vaultFixture();
  await expect(adapter.verifyDeployment(vaultBlock())).rejects.toThrow('runtime differs');
});
it.each(['0x0', zeroAddress, SPARK_USDC.vault, SPARK_USDC.asset])('rejects invalid holder %s', value => {
  expect(() => vaultAccount(value)).toThrow();
});
it('only decodes canonical direct self-redeem and self-withdraw calls', () => {
  const data = encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args: [1n, VAULT_OWNER, VAULT_OWNER] });
  expect(decodeVaultExit(data, VAULT_OWNER).mode).toBe('redeem');
  expect(() => decodeVaultExit(`${data}00` as Hex, VAULT_OWNER)).toThrow();
  expect(() => decodeVaultExit(data, VAULT_OTHER)).toThrow();
  expect(() => decodeVaultExit(encodeFunctionData({ abi: vaultAbi, functionName: 'withdraw',
    args: [0n, VAULT_OWNER, VAULT_OWNER] }), VAULT_OWNER)).toThrow();
});
