import { encodeFunctionData, getAddress, keccak256, parseAbi, zeroAddress, type Address, type Hex } from 'viem';
import type { Block, StrictRpc } from '../src/core/rpc';
import { digest } from './publish-core';

// ERC-1967, https://eips.ethereum.org/EIPS/eip-1967
export const IMPL_SLOT: Hex = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const BEACON_SLOT: Hex = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
export const ADMIN_SLOT: Hex = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const beaconAbi = parseAbi(['function implementation() view returns (address)']);
export function decodeStorageAddress(word: unknown): Address | null {
  if (typeof word !== 'string' || !/^0x0{24}[a-f0-9]{40}$/i.test(word))
    throw new Error('Malformed address storage slot');
  const address = getAddress(`0x${word.slice(-40)}`);
  return address === zeroAddress ? null : address;
}
interface Node {
  address: Address; codeHash: Hex;
  slots: { implementation: Address | null; beacon: Address | null; admin: Address | null };
  adminCodeHash: Hex | null;
}
interface Edge {
  from: Address; to: Address; kind: 'implementation-slot' | 'beacon-slot' | 'beacon-return';
}
function codeHash(code: unknown, required: boolean): Hex | null {
  if (code === '0x' && !required) return null;
  if (typeof code !== 'string' || !/^0x(?:[a-f0-9]{2})+$/i.test(code) || code.length > 2 + 262144 * 2)
    throw new Error('Proxy dependency has missing, malformed or oversized code');
  return keccak256(code as Hex);
}
export async function inspectProxyIdentity(rpc: StrictRpc, rootInput: Address, block: Block) {
  const root = getAddress(rootInput);
  if (root === zeroAddress) throw new Error('Zero proxy identity root');
  const nodes = new Map<Address, Node>(), visiting = new Set<Address>(), edges: Edge[] = [];
  async function visit(address: Address, depth: number): Promise<void> {
    if (visiting.has(address)) throw new Error('Cyclic proxy dependency observations');
    if (nodes.has(address)) return;
    if (depth > 4 || nodes.size >= 12) throw new Error('Proxy dependency observation limit exceeded');
    visiting.add(address);
    const hash = codeHash(await rpc.request('eth_getCode', [address, block.number]), true)!;
    const [implementation, beacon, admin] = await Promise.all([IMPL_SLOT, BEACON_SLOT, ADMIN_SLOT]
      .map(async slot => decodeStorageAddress(await rpc.request('eth_getStorageAt', [address, slot, block.number]))));
    if (implementation && beacon) throw new Error('Ambiguous implementation and beacon slots');
    const adminCodeHash = admin ? codeHash(await rpc.request('eth_getCode', [admin, block.number]), false) : null;
    nodes.set(address, { address, codeHash: hash, slots: { implementation, beacon, admin }, adminCodeHash });
    async function follow(to: Address, kind: Edge['kind']) {
      edges.push({ from: address, to, kind });
      await visit(to, depth + 1);
    }
    if (implementation) await follow(implementation, 'implementation-slot');
    if (beacon) {
      await follow(beacon, 'beacon-slot');
      const data = encodeFunctionData({ abi: beaconAbi, functionName: 'implementation' });
      // Two callers are a bounded consistency probe, not a proof for all callers.
      const results = await Promise.all([zeroAddress, root].map(async from =>
        decodeStorageAddress(await rpc.request('eth_call', [{ from, to: beacon, data, gas: '0x493e0' }, block.number]))));
      if (!results[0] || results[0] !== results[1]) throw new Error('Beacon implementation is zero or caller-dependent');
      edges.push({ from: beacon, to: results[0], kind: 'beacon-return' });
      if (visiting.has(results[0]) || results[0] === beacon) throw new Error('Cyclic beacon implementation');
      await visit(results[0], depth + 2);
    }
    visiting.delete(address);
  }
  await visit(root, 0);
  const graph = { schemaVersion: 1 as const, root, nodes: [...nodes.values()].sort((a, b) => a.address.localeCompare(b.address)),
    edges: edges.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  return { ...graph, identitySha256: digest(Buffer.from(JSON.stringify(graph))),
    scope: 'Fixed-block standard-slot and beacon-call observations, not an execution-path or governance proof. ' +
      'Dependency storage is read at each address, not in a delegatecall context. ' +
      'Two caller samples do not establish universal caller independence. Empty slots do not rule out custom proxies.' };
}
export type ProxyIdentity = Awaited<ReturnType<typeof inspectProxyIdentity>>;
