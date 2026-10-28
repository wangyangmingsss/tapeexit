import { afterEach, expect, it, vi } from 'vitest';
import { makePlan } from '../src/core/protocol';
import { DEMO_OWNER, demoSnapshot } from '../src/demo/engine';
import * as loader from '../src/core/plan-loader';
import { send } from '../src/core/wallet';
import { V3Adapter } from '../src/core/adapter';
import { StrictRpc, ExitError } from '../src/core/rpc';

afterEach(() => vi.restoreAllMocks());
it('never calls the wallet or preserves a send intent when the calculation chunk fails', async () => {
  const plan = makePlan(await demoSnapshot(1n, 'none'), DEMO_OWNER, 5000, 50);
  vi.spyOn(loader, 'loadPlan').mockRejectedValue(new ExitError('CALCULATION', 'Calculation unavailable'));
  const request = vi.fn(), beforeRequest = vi.fn();
  await expect(send({ request }, plan, 100000n, beforeRequest)).rejects.toMatchObject({ code: 'CALCULATION' });
  expect(request).not.toHaveBeenCalled();
  expect(beforeRequest).not.toHaveBeenCalled();
});
it('never simulates unvalidated calldata when the calculation chunk fails', async () => {
  const plan = makePlan(await demoSnapshot(1n, 'none'), DEMO_OWNER, 5000, 50);
  vi.spyOn(loader, 'loadPlan').mockRejectedValue(new ExitError('CALCULATION', 'Calculation unavailable'));
  const request = vi.fn(), rpc = new StrictRpc([
    { url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' },
  ], request);
  await expect(new V3Adapter(rpc).simulate(plan)).rejects.toMatchObject({ code: 'CALCULATION' });
  expect(request).not.toHaveBeenCalled();
});
