import { expect, it } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, parseAbiParameters } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { inspectTapeEnvironment } from '../tools/tapeout-environment';
import { IMPLEMENTATIONS, TAPE_FACTORY } from '../tools/operations-core';
import { BINDING, REGISTRY } from '../tools/publish-core';
import { parseAbi } from 'viem';
const abi = parseAbi(['function cpuCount() view returns (uint256)', 'function cpuAt(uint256) view returns (address)',
  'function isCPU(address) view returns (bool)', 'function monthlyFee() view returns (uint256)']);
function fixture() {
  const state = { changed: false, badImpl: false, code: '0x6000', registered: true, reads: 0 };
  const rpc = new StrictRpc([{ url: 'https://a.example', operator: 'a' }, { url: 'https://b.example', operator: 'b' }],
    async (_source, method, params) => {
      if (method === 'eth_chainId') return '0xc4';
      if (method === 'eth_blockNumber') return '0x12';
      if (method === 'eth_getBlockByNumber') return { number: '0x10', hash: `0x${(state.changed ? 'cd' : 'ab').repeat(32)}`,
        timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
      if (method === 'eth_getCode') return state.code;
      if (method === 'eth_getStorageAt') {
        const key = params[0] === TAPE_FACTORY ? 'factory' : params[0] === BINDING ? 'binding' : 'registry';
        const impl = state.badImpl ? REGISTRY : IMPLEMENTATIONS[key];
        return `0x${impl.slice(2).toLowerCase().padStart(64, '0')}`;
      }
      if (method === 'eth_call') {
        const tx = params[0] as { data: `0x${string}` }, decoded = decodeFunctionData({ abi, data: tx.data });
        if (decoded.functionName === 'cpuCount') return encodeAbiParameters(parseAbiParameters('uint256'), [8n]);
        if (decoded.functionName === 'monthlyFee') return encodeAbiParameters(parseAbiParameters('uint256'), [123n]);
        if (decoded.functionName === 'isCPU') return encodeAbiParameters(parseAbiParameters('bool'), [state.registered]);
        state.reads++;
        return encodeAbiParameters(parseAbiParameters('address'), [`0x${'11'.repeat(20)}`]);
      }
      throw new Error(method);
    });
  return { rpc, state };
}
it('observes bounded registry pages and does not select or approve a processor', async () => {
  const { rpc, state } = fixture(), report = await inspectTapeEnvironment(rpc);
  expect(report.processors).toHaveLength(5);
  expect(report.nextProcessorOffset).toBe('5');
  expect(state.reads).toBe(10);
  expect(report.monthlyActivationFeeWei).toBe('123');
  expect(report.approval).toBe('NOT_REVIEWED');
  expect(report.publicationExecuted).toBe(false);
});
it('reads the final registry page without exceeding the count', async () => {
  const { rpc } = fixture(), report = await inspectTapeEnvironment(rpc, 5n);
  expect(report.processors).toHaveLength(3);
  expect(report.nextProcessorOffset).toBeNull();
});
it.each([-1n, 1000000001n, 9n])('rejects an invalid or unavailable processor offset %s', async offset => {
  await expect(inspectTapeEnvironment(fixture().rpc, offset)).rejects.toThrow();
});
it('rejects a changed pinned implementation', async () => {
  const { rpc, state } = fixture(); state.badImpl = true;
  await expect(inspectTapeEnvironment(rpc)).rejects.toThrow('implementation differs');
});
it.each(['0x', '0x1', 'bad'])('rejects unavailable runtime %s', async code => {
  const { rpc, state } = fixture(); state.code = code;
  await expect(inspectTapeEnvironment(rpc)).rejects.toThrow('runtime');
});
it('rejects a processor absent from the official registry', async () => {
  const { rpc, state } = fixture(); state.registered = false;
  await expect(inspectTapeEnvironment(rpc)).rejects.toThrow('registry identity');
});
