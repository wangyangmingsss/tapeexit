import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseAbi, keccak256 } from 'viem';
import { fixture, type Fixture } from './fixture';
import { compileAcceptanceAssets, ACCEPTANCE_SUPPLY, ACCEPTANCE_DEPOSIT } from '../tools/acceptance-assets';
import { makePlan } from '../src/core/protocol';
import { inspectRecoveryOutcome } from '../src/core/recovery-outcome';
import { tokenAbi } from '../src/config';

let f: Fixture;
beforeAll(async () => { f = await fixture(18549, 'fixed-acceptance'); });
afterAll(async () => {
  if (!f?.child) return;
  const closed = new Promise<void>(resolve => f.child.once('close', () => resolve()));
  f.child.kill('SIGTERM'); await closed;
});
it('deploys the full compiled runtime including metadata with fixed supply and no privileged functions', async () => {
  const build = await compileAcceptanceAssets();
  const second = await compileAcceptanceAssets();
  expect(second).toEqual(build);
  for (const token of [f.token0, f.token1]) {
    const code = await f.client.getCode({ address: token });
    const artifact = build.artifacts.find(artifact => artifact.deployedBytecode === code);
    expect(artifact).toBeDefined();
    expect(keccak256(code!)).toBe(artifact!.runtimeCodeHash);
    const functions = artifact!.abi.filter(entry => entry.type === 'function').map(entry => entry.name);
    for (const forbidden of ['mint', 'owner', 'transferOwnership', 'setBlocked', 'pause',
      'upgradeTo', 'withdraw', 'deposit', 'selfdestruct'])
      expect(functions).not.toContain(forbidden);
    expect(await f.client.readContract({ address: token, abi: parseAbi([
      'function totalSupply() view returns (uint256)',
    ]), functionName: 'totalSupply' })).toBe(ACCEPTANCE_SUPPLY);
    const balance = await f.client.readContract({ address: token, abi: tokenAbi,
      functionName: 'balanceOf', args: [f.account] });
    expect(balance).toBeGreaterThanOrEqual(ACCEPTANCE_SUPPLY - ACCEPTANCE_DEPOSIT);
    expect(balance).toBeLessThan(ACCEPTANCE_SUPPLY);
    const allowance = await f.client.readContract({ address: token, abi: parseAbi([
      'function allowance(address,address) view returns (uint256)',
    ]), functionName: 'allowance', args: [f.account, f.manager] });
    expect(allowance).toBeLessThan(ACCEPTANCE_DEPOSIT);
  }
});
it('executes an official V3 partial exit and checks actual token balances and remaining liquidity', async () => {
  const snapshot = await f.adapter.snapshot(f.tokenId);
  const plan = makePlan(snapshot, f.account, 100, 50, false, f.deployment);
  const preview = await f.adapter.simulate(plan);
  const hash = await f.wallet.sendTransaction({ account: f.account, chain: f.wallet.chain,
    to: f.manager, data: plan.data, value: 0n, gas: preview.gas });
  expect((await f.client.waitForTransactionReceipt({ hash })).status).toBe('success');
  const outcome = await inspectRecoveryOutcome(f.adapter.rpc, hash, f.tokenId, f.account, f.deployment);
  expect(outcome.state).toBe('block-state-matched');
  if (!outcome.balances || !outcome.liquidity || !outcome.owed) throw new Error('Missing actual recovery evidence');
  expect(outcome.balances.every(asset => asset.matches)).toBe(true);
  expect(BigInt(outcome.liquidity.after)).toBe(snapshot.liquidity - plan.liquidity);
  expect(outcome.owed.cleared).toBe(true);
});
