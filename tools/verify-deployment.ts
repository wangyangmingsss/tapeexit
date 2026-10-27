import { mkdir, writeFile } from 'node:fs/promises';
import { keccak256, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { V3Adapter } from '../src/core/protocol';
import { DEPLOYMENT, SOURCES } from '../src/config';
const rpc = new StrictRpc(SOURCES);
const adapter = new V3Adapter(rpc);
const block = await rpc.pin();
await adapter.verifyDeployment(block);
const codes = await Promise.all([DEPLOYMENT.manager, DEPLOYMENT.factory].map(async address => ({
  address, codeHash: keccak256(await rpc.request<Hex>('eth_getCode', [address, block.number])),
})));
await mkdir('release-artifacts', { recursive: true });
await writeFile('release-artifacts/deployment-verification.json', JSON.stringify({
  checkedAt: new Date().toISOString(), deployment: DEPLOYMENT, block, codes, operators: SOURCES,
  scope: 'RPC agreement, non-empty code and manager factory/WETH9 getters. Not bytecode equivalence or security audit.',
}, null, 2));
console.log(JSON.stringify({ status: 'read-only-configuration-checked', block, codes }, null, 2));
