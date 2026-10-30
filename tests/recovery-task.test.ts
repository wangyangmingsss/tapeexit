// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CHAIN_ID, MANAGER } from '../src/config';
import { RECOVERY_TASK_KEY, clearRecoveryTask, importRecoveryTask, loadRecoveryTask, recoveryTask, saveRecoveryTask } from '../src/core/recovery-task';
import { SUBMISSION_KEY } from '../src/core/submission';
import task from '../docs/gateway-recovery-task-67042.json';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
const draft = () => recoveryTask(task.tokenId, task.account, task.hash);

it('persists only a deployment-bound public identity and never persists a successful outcome', () => {
  expect(saveRecoveryTask(draft())).toBe(true);
  expect(loadRecoveryTask()).toEqual({ schemaVersion: 1, chainId: CHAIN_ID, manager: MANAGER,
    tokenId: task.tokenId, account: task.account, hash: task.hash });
  expect(Object.keys(JSON.parse(localStorage.getItem(RECOVERY_TASK_KEY)!)).sort())
    .toEqual(['schemaVersion', 'chainId', 'manager', 'tokenId', 'account', 'hash'].sort());
});
it.each([
  { chainId: 1 }, { manager: task.account }, { schemaVersion: 2 }, { hash: '0x01' },
  { account: '0x0000000000000000000000000000000000000000' }, { tokenId: '01' },
  { tokenId: (1n << 256n).toString() }, { transaction: { value: '0x1' } },
  { signingApproved: true }, { outcome: { state: 'block-state-matched' } },
])('ignores an invalid stored recovery task %j without treating it as an instruction', change => {
  localStorage.setItem(RECOVERY_TASK_KEY, JSON.stringify({ ...draft(), ...change }));
  expect(loadRecoveryTask()).toBeUndefined();
});
it.each(['{', '[]', 'null', 'x'.repeat(1025)])('ignores malformed or oversized storage', raw => {
  localStorage.setItem(RECOVERY_TASK_KEY, raw);
  expect(loadRecoveryTask()).toBeUndefined();
});
it('clears only recovery hints and leaves pending wallet submissions untouched', () => {
  localStorage.setItem(SUBMISSION_KEY, 'preserved pending marker');
  saveRecoveryTask(draft());
  expect(clearRecoveryTask()).toBe(true);
  expect(loadRecoveryTask()).toBeUndefined();
  expect(localStorage.getItem(SUBMISSION_KEY)).toBe('preserved pending marker');
});
it('reports storage failures rather than claiming that hints were saved', () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  expect(saveRecoveryTask(draft())).toBe(false);
});
it('imports a cross-origin report as transaction identity only, discarding its claimed outcome', () => {
  const report = { schemaVersion: 1, environment: 'MAINNET_READ_ONLY', signingApproved: false,
    task: draft(), observedAt: new Date().toISOString(), outcome: { state: 'block-state-matched', approved: true } };
  expect(importRecoveryTask(JSON.stringify(report))).toEqual(draft());
  expect(importRecoveryTask(JSON.stringify(draft()))).toEqual(draft());
});
it.each([
  { environment: 'DEMO' }, { signingApproved: true }, { observedAt: 'invalid' },
  { gateway: 'https://evil.example' }, { task: { ...draft(), chainId: 1 } },
])('rejects unsafe imported reports %j', change => {
  const report = { schemaVersion: 1, environment: 'MAINNET_READ_ONLY', signingApproved: false,
    task: draft(), observedAt: new Date().toISOString(), outcome: {}, ...change };
  expect(() => importRecoveryTask(JSON.stringify(report))).toThrow();
});
it('rejects an oversized import', () => {
  expect(() => importRecoveryTask(' '.repeat(65537))).toThrow('too large');
});
