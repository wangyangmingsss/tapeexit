import { expect, it } from 'vitest';
import taskInput from '../docs/gateway-recovery-task-67042.json';
import { parseGatewayRecoveryTask, assertGatewayRecoveryTask } from '../tools/gateway-recovery-task';

const task = parseGatewayRecoveryTask(taskInput);
function report() {
  return { schemaVersion: 1, environment: 'MAINNET_READ_ONLY', signingApproved: false,
    observedAt: new Date().toISOString(), outcome: {
      state: 'block-state-matched', hash: task.hash, account: task.account, tokenId: task.tokenId,
      identityMatches: true, receipt: { finalized: true },
      liquidity: { matches: true, after: task.remainingLiquidity }, owed: { cleared: true },
      balances: task.assets.map(a => ({ ...a, receiptAmount: a.delta, matches: true })),
    } };
}
it('requires the same finalized mainnet recovery task with exact arrivals', () => {
  expect(assertGatewayRecoveryTask(task, report())).toHaveProperty('signingApproved', false);
});
it.each(['hash', 'account', 'tokenId', 'arrival', 'liquidity', 'finality', 'state', 'stale', 'signing'])(
  'rejects changed recovery evidence: %s', field => {
    const v = report();
    if (field === 'hash') v.outcome.hash = `0x${'ab'.repeat(32)}`;
    if (field === 'account') v.outcome.account = task.assets[0].address;
    if (field === 'tokenId') v.outcome.tokenId = '1';
    if (field === 'arrival') v.outcome.balances[0].delta = '1';
    if (field === 'liquidity') v.outcome.liquidity.after = '1';
    if (field === 'finality') v.outcome.receipt.finalized = false;
    if (field === 'state') v.outcome.state = 'block-state-mismatch';
    if (field === 'stale') v.observedAt = '2020-01-01T00:00:00Z';
    if (field === 'signing') v.signingApproved = true;
    expect(() => assertGatewayRecoveryTask(task, v)).toThrow();
  });
it('rejects unsafe task substitutions and duplicate assets', () => {
  for (const input of [{ ...taskInput, tokenId: '01' }, { ...taskInput, account: '0x123' },
    { ...taskInput, hash: `0x${'0'.repeat(64)}` }, { ...taskInput, script: 'ignored' },
    { ...taskInput, assets: [taskInput.assets[0], taskInput.assets[0]] }])
    expect(() => parseGatewayRecoveryTask(input)).toThrow();
});
