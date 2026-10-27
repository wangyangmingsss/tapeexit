import { makePlan } from '../../src/core/protocol';
import { demoSnapshot, DEMO_OWNER } from '../../src/demo/engine';
import { sendGuarded, submissionState } from '../../src/core/submission';
import { runtimeStatus, assertSigningRuntime } from '../../src/core/runtime';

let finish: (result: 'hash' | 'reject' | 'unknown') => void;
let sendCount = 0;
let outcome = '';
const harness = {
  state: submissionState,
  runtime: runtimeStatus,
  assertRuntime: assertSigningRuntime,
  count: () => sendCount,
  outcome: () => outcome,
  finish: (result: 'hash' | 'reject' | 'unknown') => finish(result),
  async start() {
    outcome = '';
    const plan = makePlan(await demoSnapshot(12n, 'none'), DEMO_OWNER, 5000, 50);
    const provider = { request: async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return [DEMO_OWNER];
      if (method === 'eth_chainId') return '0xc4';
      if (method !== 'eth_sendTransaction') throw new Error('Unexpected synthetic provider request');
      sendCount++;
      return new Promise((resolve, reject) => {
        finish = result => result === 'hash' ? resolve(`0x${'ab'.repeat(32)}`) :
          reject(result === 'reject' ? { code: 4001 } : new Error('Synthetic disconnect'));
      });
    } };
    // Retain a handled promise so a held synthetic wallet request does not block page.evaluate.
    void sendGuarded(provider, plan, 100000n).then(() => { outcome = 'sent'; }, error => {
      outcome = String(error.code ?? error.message);
    });
  },
};
declare global { interface Window { harness: typeof harness } }
window.harness = harness;
