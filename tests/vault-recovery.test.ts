import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeFunctionData } from 'viem';
import { SparkVaultAdapter } from '../src/core/vault-adapter';
import { importVaultRecovery, inspectVaultRecovery, vaultRecoveryTask } from '../src/core/vault-recovery';
import { SPARK_USDC, vaultAbi } from '../src/core/vault-config';
import { VAULT_HASH, VAULT_OTHER, VAULT_OWNER, vaultFixture } from './vault-fixture';

beforeEach(() => vi.spyOn(SparkVaultAdapter.prototype, 'verifyDeployment').mockResolvedValue());
afterEach(() => vi.restoreAllMocks());
const task = () => vaultRecoveryTask(VAULT_OWNER, VAULT_HASH);
it('verifies direct redemption, USDC receipt, share burn, remaining shares and finality', async () => {
  const { rpc } = vaultFixture();
  const hints = importVaultRecovery(JSON.stringify({ ...task(), state: 'verified', signingApproved: true }));
  expect(hints).not.toHaveProperty('state');
  expect(hints).not.toHaveProperty('signingApproved');
  const first = await inspectVaultRecovery(rpc, hints);
  expect(first).toMatchObject({ state: 'verified', assets: '255000', shares: '250000',
    remainingShares: '750000', finalized: true, transactionSent: false, signingApproved: false });
  expect(await inspectVaultRecovery(rpc, importVaultRecovery(JSON.stringify(hints)))).toEqual(first);
});
it('supports an existing direct withdraw as well as redeem', async () => {
  const { rpc, state } = vaultFixture();
  state.tx.input = encodeFunctionData({ abi: vaultAbi, functionName: 'withdraw', args: [255000n, VAULT_OWNER, VAULT_OWNER] });
  expect(await inspectVaultRecovery(rpc, task())).toMatchObject({ state: 'verified', mode: 'withdraw' });
});
it('preserves pending and reverted states without marking them complete', async () => {
  const f = vaultFixture(); f.state.receipt = null;
  expect(await inspectVaultRecovery(f.rpc, task())).toEqual({ state: 'pending' });
  const g = vaultFixture(); g.state.receipt!.status = '0x0'; g.state.receipt!.logs = [];
  expect(await inspectVaultRecovery(g.rpc, task())).toMatchObject({ state: 'reverted' });
});
it('waits for finalized tag instead of treating a mined receipt as completion', async () => {
  const { rpc, state } = vaultFixture(); state.finality = '0xf';
  expect(await inspectVaultRecovery(rpc, task())).toMatchObject({ state: 'awaiting-finality', finalized: false });
});
it.each(['asset-transfer', 'share-burn', 'withdraw-event'])('rejects missing %s evidence', async which => {
  const { rpc, state } = vaultFixture();
  state.receipt!.logs.splice(['asset-transfer', 'share-burn', 'withdraw-event'].indexOf(which), 1);
  await expect(inspectVaultRecovery(rpc, task())).rejects.toThrow();
});
it('rejects a second Withdraw event rather than summing unrelated claims', async () => {
  const { rpc, state } = vaultFixture();
  state.receipt!.logs.push({ ...state.receipt!.logs[2], logIndex: '0x3' });
  await expect(inspectVaultRecovery(rpc, task())).rejects.toThrow('do not match');
});
it.each(['receipt', 'target', 'sender', 'value', 'data', 'amount', 'transfer', 'receiver'] as const)(
  'rejects %s mismatches', async which => {
    const { rpc, state } = vaultFixture();
    if (which === 'receipt') state.receipt!.transactionHash = `0x${'cd'.repeat(32)}`;
    if (which === 'target') state.tx.to = VAULT_OTHER;
    if (which === 'sender') state.tx.from = VAULT_OTHER;
    if (which === 'value') state.tx.value = '0x1';
    if (which === 'data') state.tx.input = `${state.tx.input}00`;
    if (which === 'amount') state.tx.input = encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args: [1n, VAULT_OWNER, VAULT_OWNER] });
    if (which === 'transfer') state.receipt!.logs[0].data = encodeAbiParameters([{ type: 'uint256' }], [1n]);
    if (which === 'receiver') state.tx.input = encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args: [250000n, VAULT_OTHER, VAULT_OWNER] });
    await expect(inspectVaultRecovery(rpc, task())).rejects.toThrow();
  });
it.each(['asset', 'shares'])('does not mark same-block %s state discrepancies as verified', async kind => {
  const { rpc, state } = vaultFixture();
  if (kind === 'asset') state.afterAssets++;
  else state.afterShares++;
  expect(await inspectVaultRecovery(rpc, task())).toMatchObject({ state: 'block-state-mismatch', eventsChecked: true });
});
describe('recovery imports are protocol-specific public hints', () => {
  it.each([
    { chainId: 1 }, { protocolId: 'uniswap-v3' }, { vault: VAULT_OTHER },
    { account: 'invalid' }, { hash: '0x123' }, { hash: `0x${'0'.repeat(64)}` },
    { schemaVersion: 2 },
  ])('rejects different or invalid identity %j', patch => {
    expect(() => importVaultRecovery(JSON.stringify({ ...task(), ...patch }))).toThrow();
  });
  it('rejects oversized recovery records', () => {
    expect(() => importVaultRecovery(JSON.stringify({ ...task(), padding: 'a'.repeat(16384) }))).toThrow();
  });
  it('does not accept a V3 recovery file or a generic JSON object as a vault task', () => {
    expect(() => importVaultRecovery('{}')).toThrow();
    expect(() => importVaultRecovery(JSON.stringify({ schemaVersion: 1, tokenId: '67042',
      manager: SPARK_USDC.vault, account: VAULT_OWNER, hash: VAULT_HASH }))).toThrow();
  });
});
