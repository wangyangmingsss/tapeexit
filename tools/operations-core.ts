import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, zeroAddress,
  type Abi, type Address, type Hex } from 'viem';
import { StrictRpc, type Block } from '../src/core/rpc';
import { tokenAbi } from '../src/config';
import { BINDING, REGISTRY, publishAbi, type PublishTransaction } from './publish-core';

// Identity/implementation pins from TapeKit 37c617e7, kernel/src/config.js.
export const TAPE_FACTORY = getAddress('0x1f09daefa827f02cbb40967cc91b259763760761');
export const OPENER = getAddress('0x536add8f30f03b69f6fbf29d425a816a0dc50106');
export const IMPL_SLOT: Hex = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const BEACON_SLOT: Hex = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
export const IMPLEMENTATIONS = {
  registry: getAddress('0xa85c4143d1d4a77f54b8e4ecc9e6d1418afea45f'),
  binding: getAddress('0x5ebf29b80789e548907c707530c3c7607c4347df'),
  factory: getAddress('0xb41c1e7602eb5734be2430b72178ccb814a5293d'),
} as const;
export const identityAbi = parseAbi([
  'function cpuAt(uint256) view returns (address)',
  'function isCPU(address) view returns (bool)',
  'function accountOf(address,uint256) view returns (address)',
  'function isOpened(address,uint256) view returns (bool)',
  'function ownerOf(uint256) view returns (address)',
  'function token() view returns (uint256,address,uint256)',
  'function monthlyFee() view returns (uint256)',
  'function isContainerLive(address) view returns (bool)',
]);
const hashPattern = /^0x[a-f0-9]{64}$/i;
const integerPattern = /^(0|[1-9][0-9]{0,77})$/;
function uint(value: unknown, name: string, maximum = (1n << 256n) - 1n): bigint {
  if (typeof value !== 'string' || !integerPattern.test(value) || BigInt(value) > maximum)
    throw new Error(`Invalid ${name}; use an unsigned decimal string`);
  return BigInt(value);
}
function address(value: unknown): Address {
  if (typeof value !== 'string') throw new Error('Missing address');
  const result = getAddress(value);
  if (result === zeroAddress) throw new Error('Zero address');
  return result;
}
export interface PublishProfile {
  schemaVersion: 1; chainId: 196; publisher: Address; container: Address;
  processorIndex: string; circuitId: string;
  maxGasPerTransaction: string; maxFeePerGasWei: string; maxUploadCostWei: string;
  expectedCodeHashes: Record<'processor' | 'container' | 'opener' | 'registry' | 'binding' | 'factory', Hex>;
}
export function parsePublishProfile(input: unknown): PublishProfile {
  const p = input as PublishProfile | null;
  if (!p || p.schemaVersion !== 1 || p.chainId !== 196) throw new Error('Expected X Layer publication profile');
  uint(p.processorIndex, 'processor index', 1_000_000_000n);
  uint(p.circuitId, 'circuit ID', 10n ** 18n);
  for (const name of ['maxGasPerTransaction', 'maxFeePerGasWei', 'maxUploadCostWei'] as const)
    if (uint(p[name], name) === 0n) throw new Error(`Explicit positive ${name} required`);
  for (const name of ['processor', 'container', 'opener', 'registry', 'binding', 'factory'] as const)
    if (!p.expectedCodeHashes || typeof p.expectedCodeHashes[name] !== 'string' || !hashPattern.test(p.expectedCodeHashes[name]) ||
        /^0x0{64}$/i.test(p.expectedCodeHashes[name])) throw new Error(`Reviewed ${name} code hash required`);
  return { ...p, publisher: address(p.publisher), container: address(p.container) };
}
async function call<T>(rpc: StrictRpc, block: Block, to: Address, abi: Abi, name: string, args: readonly unknown[] = []) {
  const data = await rpc.request<Hex>('eth_call', [{ to, data: encodeFunctionData({
    abi, functionName: name, args,
  }) }, block.number]);
  return decodeFunctionResult({ abi, functionName: name, data }) as T;
}
export function decodeStorageAddress(word: unknown): Address | null {
  if (typeof word !== 'string' || !/^0x0{24}[a-f0-9]{40}$/i.test(word))
    throw new Error('Malformed address storage slot');
  const value = getAddress(`0x${word.slice(-40)}`);
  return value === zeroAddress ? null : value;
}
export async function inspectPublication(rpc: StrictRpc, input: unknown, transactions: PublishTransaction[]) {
  const p = parsePublishProfile(input);
  if (!transactions.length || transactions.length > 100_000) throw new Error('Invalid transaction count');
  if (transactions.some(tx => tx.to !== REGISTRY || tx.value !== '0' || !/^0x(?:[a-f0-9]{2})+$/i.test(tx.data)))
    throw new Error('Unexpected publication target or value');
  for (const tx of transactions) {
    const decoded = decodeFunctionData({ abi: publishAbi, data: tx.data });
    if (getAddress(decoded.args[0]) !== p.container) throw new Error('Publication calldata targets another container');
    let intrinsicGas = 21000n;
    for (let offset = 2; offset < tx.data.length; offset += 2)
      intrinsicGas += tx.data.slice(offset, offset + 2) === '00' ? 4n : 16n;
    if (intrinsicGas > BigInt(p.maxGasPerTransaction)) throw new Error('Gas ceiling is below calldata intrinsic cost');
  }
  await rpc.checkChain(196);
  const block = await rpc.pin();
  const processor = address(await call<Address>(rpc, block, TAPE_FACTORY, identityAbi, 'cpuAt', [BigInt(p.processorIndex)]));
  const [registered, derived, opened, owner, token] = await Promise.all([
    call<boolean>(rpc, block, TAPE_FACTORY, identityAbi, 'isCPU', [processor]),
    call<Address>(rpc, block, OPENER, identityAbi, 'accountOf', [processor, BigInt(p.circuitId)]),
    call<boolean>(rpc, block, OPENER, identityAbi, 'isOpened', [processor, BigInt(p.circuitId)]),
    call<Address>(rpc, block, processor, identityAbi, 'ownerOf', [BigInt(p.circuitId)]),
    call<readonly [bigint, Address, bigint]>(rpc, block, p.container, identityAbi, 'token'),
  ]);
  if (!registered || !opened || getAddress(derived) !== p.container || getAddress(owner) !== p.publisher ||
      token[0] !== 196n || getAddress(token[1]) !== processor || token[2] !== BigInt(p.circuitId))
    throw new Error('Container, processor, opening or publisher identity mismatch');
  const codeHashes: Record<string, Hex> = {};
  for (const [name, to] of Object.entries({ processor, container: p.container, opener: OPENER,
    registry: REGISTRY, binding: BINDING, factory: TAPE_FACTORY })) {
    const code = await rpc.request<Hex>('eth_getCode', [to, block.number]);
    if (!/^0x(?:[a-f0-9]{2})+$/i.test(code)) throw new Error(`Missing ${name} code`);
    const hash = keccak256(code);
    if (hash.toLowerCase() !== p.expectedCodeHashes[name as keyof PublishProfile['expectedCodeHashes']].toLowerCase())
      throw new Error(`${name} code differs from profile`);
    codeHashes[name] = hash;
  }
  for (const [name, to] of Object.entries({ registry: REGISTRY, binding: BINDING, factory: TAPE_FACTORY })) {
    const impl = decodeStorageAddress(await rpc.request<Hex>('eth_getStorageAt', [to, IMPL_SLOT, block.number]));
    if (impl !== IMPLEMENTATIONS[name as keyof typeof IMPLEMENTATIONS])
      throw new Error(`${name} implementation differs from pinned TapeKit`);
    const code = await rpc.request<Hex>('eth_getCode', [impl, block.number]);
    if (code === '0x') throw new Error(`${name} implementation missing`);
    codeHashes[`${name}ImplementationObserved`] = keccak256(code);
  }
  const [fee, live] = await Promise.all([
    call<bigint>(rpc, block, BINDING, identityAbi, 'monthlyFee'),
    call<boolean>(rpc, block, BINDING, identityAbi, 'isContainerLive', [p.container]),
  ]);
  const maximumUploadCost = BigInt(p.maxGasPerTransaction) * BigInt(p.maxFeePerGasWei) * BigInt(transactions.length);
  if (maximumUploadCost > BigInt(p.maxUploadCostWei)) throw new Error('Upload gas ceilings exceed total budget');
  // Only the first operation can be simulated without applying earlier writes.
  await rpc.request('eth_call', [{ from: p.publisher, to: REGISTRY, data: transactions[0].data, value: '0x0' }, block.number]);
  await rpc.assertBlock(block);
  return { schemaVersion: 1, status: 'identity-checked-unsigned', observedAt: new Date().toISOString(),
    chainId: 196, block, publisher: p.publisher, processor, container: p.container,
    circuitId: p.circuitId, processorIndex: p.processorIndex, codeHashes,
    transactionCount: transactions.length, maximumUploadCostWei: maximumUploadCost.toString(),
    monthlyActivationFeeWei: fee.toString(), containerLive: live, firstOperationSimulation: 'passed',
    scope: 'Read-only identity and caller-supplied code pins; first operation simulation only. ' +
      'Gas ceilings are an arithmetic bound, not gas estimates. Activation is excluded. ' +
      'Listing/lock rejection is checked only by the first simulated call. ' +
      'Implementation code hashes are observed, not independently approved. ' +
      'Processor beacon/factory sealing, sequential estimates and fresh wallet review remain required. No signing or payment.' };
}
export async function inspectAssets(rpc: StrictRpc, addresses: string[]) {
  if (!addresses.length || addresses.length > 20) throw new Error('Supply 1 to 20 candidate token addresses');
  const tokens = addresses.map(address);
  if (new Set(tokens).size !== tokens.length) throw new Error('Duplicate candidate token');
  await rpc.checkChain(196);
  const block = await rpc.pin();
  const assets = [];
  for (const token of tokens) {
    const code = await rpc.request<Hex>('eth_getCode', [token, block.number]);
    if (!/^0x(?:[a-f0-9]{2})+$/i.test(code)) throw new Error('Candidate has no code');
    const decimals = Number(await call<number>(rpc, block, token, tokenAbi, 'decimals'));
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token precision');
    const symbol = String(await call<string>(rpc, block, token, tokenAbi, 'symbol')).slice(0, 24);
    const slots: Record<string, Address | null> = {};
    for (const [name, slot] of Object.entries({ implementation: IMPL_SLOT, beacon: BEACON_SLOT }))
      slots[name] = decodeStorageAddress(await rpc.request<Hex>('eth_getStorageAt', [token, slot, block.number]));
    const implementationHashes: Record<string, Hex> = {};
    for (const [name, to] of Object.entries(slots)) if (to) {
      const implementationCode = await rpc.request<Hex>('eth_getCode', [to, block.number]);
      if (implementationCode === '0x') throw new Error('Candidate proxy points to missing code');
      implementationHashes[name] = keccak256(implementationCode);
    }
    assets.push({ address: token, symbol, decimals, codeHash: keccak256(code), slots, implementationHashes,
      approval: 'NOT_APPROVED', behavior: 'NOT_ASSESSED' });
  }
  await rpc.assertBlock(block);
  return { schemaVersion: 1, status: 'candidate-metadata-only', observedAt: new Date().toISOString(),
    chainId: 196, block, assets, operators: rpc.sources,
    limitations: ['No token is added to SUPPORTED_TOKENS',
      'Empty EIP-1967 slots do not prove absence of a proxy or upgradeability',
      'Beacon code is recorded; its implementation and governance are not resolved',
      'No proof of standard transfer behavior, tax, rebase, blacklist, pause, issuer identity or safety'] };
}
