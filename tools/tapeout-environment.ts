import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi,
  zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { OPENER, TAPE_FACTORY, IMPLEMENTATIONS } from './operations-core';
import { BINDING, REGISTRY } from './publish-core';
import { IMPL_SLOT, decodeStorageAddress } from './proxy-identity-core';

const abi: Abi = parseAbi(['function cpuCount() view returns (uint256)',
  'function cpuAt(uint256) view returns (address)', 'function isCPU(address) view returns (bool)',
  'function monthlyFee() view returns (uint256)']);

export async function inspectTapeEnvironment(rpc: StrictRpc, offset = 0n) {
  if (offset < 0n || offset > 1000000000n) throw new Error('Invalid processor offset');
  await rpc.checkChain(196);
  const block = await rpc.pin();
  async function call(to: Address, functionName: string, args: readonly unknown[] = []) {
    const data = await rpc.request<Hex>('eth_call', [{
      to, data: encodeFunctionData({ abi, functionName, args }),
    }, block.number]);
    return decodeFunctionResult({ abi, functionName, data });
  }
  async function codeHash(to: Address) {
    const bytes = await rpc.request<Hex>('eth_getCode', [to, block.number]);
    if (typeof bytes !== 'string' || !/^0x(?:[a-f0-9]{2})+$/i.test(bytes) || bytes.length > 524290)
      throw new Error('Missing or oversized observed runtime');
    return keccak256(bytes);
  }
  const contracts = [];
  for (const [name, address] of Object.entries({ factory: TAPE_FACTORY, registry: REGISTRY, binding: BINDING, opener: OPENER })) {
    const observedCodeHash = await codeHash(address);
    const expected = IMPLEMENTATIONS[name as keyof typeof IMPLEMENTATIONS];
    let implementation;
    if (expected) {
      const actual = decodeStorageAddress(await rpc.request<Hex>('eth_getStorageAt', [address, IMPL_SLOT, block.number]));
      if (actual !== expected) throw new Error(`Observed ${name} implementation differs from pinned TapeKit`);
      implementation = { address: actual, codeHash: await codeHash(actual) };
    }
    contracts.push({ name, address, codeHash: observedCodeHash, ...(implementation ? { implementation } : {}) });
  }
  const count = await call(TAPE_FACTORY, 'cpuCount') as bigint;
  const monthlyFee = await call(BINDING, 'monthlyFee') as bigint;
  if (offset > count) throw new Error('Processor offset exceeds observed registry count');
  const processors = [];
  for (let index = offset; index < count && index < offset + 5n; index++) {
    const address = getAddress(await call(TAPE_FACTORY, 'cpuAt', [index]) as Address);
    if (address === zeroAddress || await call(TAPE_FACTORY, 'isCPU', [address]) !== true)
      throw new Error('Processor registry identity mismatch');
    processors.push({ index: index.toString(), address, codeHash: await codeHash(address) });
  }
  await rpc.assertBlock(block);
  return { schemaVersion: 1, status: 'PUBLIC_ENVIRONMENT_OBSERVED', chainId: 196,
    observedAt: new Date().toISOString(), block, contracts, processorCount: count.toString(),
    processorOffset: offset.toString(), processors, nextProcessorOffset: offset + BigInt(processors.length) < count ?
      (offset + BigInt(processors.length)).toString() : null, monthlyActivationFeeWei: monthlyFee.toString(),
    operatorLabels: rpc.sources.map(source => source.operator),
    approval: 'NOT_REVIEWED', publicationExecuted: false,
    missingUserInputs: ['controlled publisher public address', 'owned circuit ID and processor index',
      'actual container identity or authorization to obtain one', 'bounded upload and activation budget',
      'two gateway origins and hosting access', 'independent code and asset reviewer'],
    scope: 'Fixed-block two-source public registry observations using pinned TapeKit interfaces. ' +
      'No proof of processor sealing, ownership, independent security or future pricing. ' +
      'Listed processors are not selected or approved for use. No wallet login, signing, circuit creation, activation or publication.',
  };
}
