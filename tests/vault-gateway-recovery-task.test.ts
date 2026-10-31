import { expect, it } from 'vitest';
import input from '../docs/gateway-recovery-task-spark.json';
import { assertVaultGatewayRecoveryTask, parseVaultGatewayRecoveryTask } from '../tools/vault-gateway-recovery-task';

const task = parseVaultGatewayRecoveryTask(input);
function result() {
  return { state: 'verified', task: { ...task.recovery }, mode: 'redeem',
    assets: '500002', shares: '498084', remainingShares: '0',
    balances: { before: '514308', after: '1014310', delta: '500002', matches: true },
    shareBalance: { before: '498084', after: '0', matches: true },
    beforeBlock: { number: '0x473488c' }, block: { number: '0x473488d' },
    eventsChecked: true, safe: true, finalized: true, transactionSent: false, signingApproved: false };
}
it('requires finalized exact USDC arrival and share destruction from the same vault task', () => {
  expect(assertVaultGatewayRecoveryTask(task, result())).toHaveProperty('remainingShares', '0');
});
it.each(['state', 'hash', 'account', 'vault', 'chain', 'assets', 'shares', 'remaining', 'balance',
  'burn', 'events', 'finality', 'safe', 'signing', 'sent', 'parent'])('rejects altered %s', field => {
  const v = result();
  if (field === 'state') v.state = 'awaiting-finality';
  if (field === 'hash') v.task.hash = `0x${'ab'.repeat(32)}`;
  if (field === 'account') v.task.account = '0x1111111111111111111111111111111111111111';
  if (field === 'vault') v.task.vault = '0x1111111111111111111111111111111111111111';
  if (field === 'chain') (v.task as { chainId: number }).chainId = 1;
  if (field === 'assets') v.assets = '500001';
  if (field === 'shares') v.shares = '498083';
  if (field === 'remaining') v.remainingShares = '1';
  if (field === 'balance') v.balances.after = '1014309';
  if (field === 'burn') v.shareBalance.before = '498083';
  if (field === 'events') v.eventsChecked = false;
  if (field === 'finality') v.finalized = false;
  if (field === 'safe') v.safe = false;
  if (field === 'signing') v.signingApproved = true;
  if (field === 'sent') v.transactionSent = true;
  if (field === 'parent') v.beforeBlock.number = '0x473488b';
  expect(() => assertVaultGatewayRecoveryTask(task, v)).toThrow();
});
it('rejects malformed or ambiguous expected amounts and unrecognized fields', () => {
  for (const v of [{ ...input, assets: '0500002' }, { ...input, shares: '0' },
    { ...input, assets: (2n ** 256n).toString() }, { ...input, script: 'unused' },
    { ...input, recovery: { ...input.recovery, chainId: 1 } },
    { ...input, recovery: { ...input.recovery, verified: true } }])
    expect(() => parseVaultGatewayRecoveryTask(v)).toThrow();
});
