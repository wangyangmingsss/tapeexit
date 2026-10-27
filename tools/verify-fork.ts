import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { DEPLOYMENT, MANAGER, SOURCES, managerAbi, tokenAbi } from '../src/config';
import { StrictRpc, httpRequest, type Requester } from '../src/core/rpc';
import { V3Adapter, makePlan, type Snapshot } from '../src/core/protocol';
import { inspectReceipt } from '../src/core/receipt';

// Every write below is restricted to this exact loopback Anvil instance.
const port = 18546;
const localUrl = `http://127.0.0.1:${port}`;
const mainnet = new StrictRpc(SOURCES);
await mainnet.checkChain(196);
const requestedBlock = process.argv.find(arg => arg.startsWith('--block='))?.slice(8);
const pinned = requestedBlock ? await mainnet.block(`0x${BigInt(requestedBlock).toString(16)}`) : await mainnet.pin();
const enumerationAbi = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function tokenByIndex(uint256 index) view returns (uint256)',
]);
async function enumerate(name: 'totalSupply' | 'tokenByIndex', args: readonly bigint[]) {
  const data = await mainnet.request<Hex>('eth_call', [{
    to: MANAGER, data: encodeFunctionData({ abi: enumerationAbi, functionName: name, args: args as [] }),
  }, pinned.number]);
  return decodeFunctionResult({ abi: enumerationAbi, functionName: name, data }) as bigint;
}
const supply = await enumerate('totalSupply', []);
const child = spawn(process.execPath, ['node_modules/@foundry-rs/anvil/bin.mjs',
  '--port', String(port), '--chain-id', '196', '--fork-url', SOURCES[0].url,
  '--fork-block-number', BigInt(pinned.number).toString(), '--silent'], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr?.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-2000); });
child.on('error', error => { stderr = error.message; });
const source = { url: localUrl, operator: 'isolated-xlayer-fork' };
const local: Requester = async (_source, method, params) => httpRequest(source, method, params);
const writeLocal = async (method: string, params: unknown[]) => {
  if (!['anvil_setBalance', 'anvil_impersonateAccount', 'eth_sendTransaction', 'evm_mine'].includes(method))
    throw new Error('Local write method is not allowed');
  return local(source, method, params);
};
const rpc = new StrictRpc([
  { url: localUrl, operator: 'same-local-fork-a' }, { url: localUrl, operator: 'same-local-fork-b' },
], local);
const timeout = setTimeout(() => child.kill('SIGTERM'), 120000);
try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error(`Anvil exited: ${stderr}`);
    try {
      const response = await fetch(localUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(1000) });
      if ((await response.json()).result === '0xc4') { ready = true; break; }
    } catch { /* Anvil may still be initializing its pinned fork. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Anvil fork did not become ready: ${stderr}`);
  await writeLocal('evm_mine', []); await writeLocal('evm_mine', []);
  const reader = new V3Adapter(rpc, DEPLOYMENT);
  let snapshot: Snapshot | undefined;
  const candidateFailures: { tokenId: string; error: string }[] = [];
  for (let offset = 0n; offset < supply && offset < 12n; offset++) {
    const tokenId = await enumerate('tokenByIndex', [supply - 1n - offset]);
    try {
      const candidate = await reader.snapshot(tokenId);
      if (candidate.liquidity === 0n) continue;
      const code = await rpc.request<Hex>('eth_getCode', [candidate.owner, 'latest']);
      if (code !== '0x') continue;
      makePlan({ ...candidate, token0: { ...candidate.token0, verified: true },
        token1: { ...candidate.token1, verified: true } }, candidate.owner, 5000, 50);
      snapshot = candidate; break;
    } catch (error) {
      candidateFailures.push({ tokenId: tokenId.toString(), error: String(error).slice(0, 200) });
    }
  }
  if (!snapshot) throw new Error(`No directly owned candidate found: ${JSON.stringify(candidateFailures)}`);
  // Test-only asset selection is not a production allowlist approval.
  const adapter = new V3Adapter(rpc, DEPLOYMENT, [snapshot.token0.address, snapshot.token1.address]);
  snapshot = await adapter.snapshot(snapshot.tokenId);
  await writeLocal('anvil_setBalance', [snapshot.owner, '0x8ac7230489e80000']);
  await writeLocal('anvil_impersonateAccount', [snapshot.owner]);
  const plan = makePlan(snapshot, snapshot.owner, 5000, 50);
  const preview = await adapter.simulate(plan);
  async function balance(token: Address) {
    const data = await rpc.request<Hex>('eth_call', [{
      to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'balanceOf', args: [snapshot!.owner] }),
    }, 'latest']);
    return decodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', data });
  }
  const before = await Promise.all([balance(snapshot.token0.address), balance(snapshot.token1.address)]);
  const hash = await writeLocal('eth_sendTransaction', [{
    from: plan.account, to: plan.manager, data: plan.data, value: '0x0', gas: `0x${preview.gas.toString(16)}`,
  }]) as Hex;
  const result = await inspectReceipt(rpc, hash, plan);
  if (result?.state !== 'received-checked') throw new Error('Local fork collection evidence not checked');
  const after = await Promise.all([balance(snapshot.token0.address), balance(snapshot.token1.address)]);
  if (after[0] - before[0] !== BigInt(result.amount0) || after[1] - before[1] !== BigInt(result.amount1))
    throw new Error('Local fork balance changes differ from transfer evidence');
  const raw = await rpc.request<Hex>('eth_call', [{
    to: MANAGER, data: encodeFunctionData({ abi: managerAbi, functionName: 'positions', args: [snapshot.tokenId] }),
  }, 'latest']);
  const position = decodeFunctionResult({ abi: managerAbi, functionName: 'positions', data: raw });
  if (position[7] !== snapshot.liquidity - plan.liquidity) throw new Error('Remaining liquidity mismatch');
  await mainnet.assertBlock(pinned);
  await mkdir('release-artifacts', { recursive: true });
  const evidence = { status: 'isolated-xlayer-fork-passed', pinned, tokenId: snapshot.tokenId.toString(),
    owner: snapshot.owner, manager: MANAGER, token0: snapshot.token0, token1: snapshot.token1,
    result, balanceDeltas: after.map((n, i) => (n - before[i]).toString()),
    remainingLiquidity: position[7].toString(), candidateFailures,
    limitations: ['Local fork only; no mainnet transaction', 'Owner impersonated on local Anvil only',
      'Both test source labels target the same local EVM', 'Test assets are not approved production assets'] };
  await writeFile('release-artifacts/xlayer-fork-verification.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    child.kill('SIGTERM'); await closed;
  }
}
