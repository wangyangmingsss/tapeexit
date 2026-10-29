import { readFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex, type Abi } from 'viem';
import { foundry } from 'viem/chains';
import { StrictRpc, type Requester } from '../src/core/rpc';
import { V3Adapter } from '../src/core/protocol';
import type { Deployment } from '../src/config';
import { compileAcceptanceAssets, ACCEPTANCE_DEPOSIT } from '../tools/acceptance-assets';
// solc 0.7.6 is needed only to compile the isolated test token.
// @ts-expect-error Historical Solidity compiler has no TS declarations.
import solc from 'solc';

export interface Fixture {
  child: ChildProcess; account: Address; other: Address; manager: Address; factory: Address;
  token0: Address; token1: Address; tokenId: bigint; adapter: V3Adapter; deployment: Deployment;
  client: ReturnType<typeof createPublicClient>; wallet: ReturnType<typeof createWalletClient>;
}
export async function fixture(port = 18545, tokenVariant: 'mutable-fixture' | 'fixed-acceptance' = 'mutable-fixture'): Promise<Fixture> {
  const child = spawn(process.execPath, ['node_modules/@foundry-rs/anvil/bin.mjs', '--port', String(port), '--silent'], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const client = createPublicClient({ chain: foundry, transport: http(url) });
  for (let i = 0; i < 100; i++) {
    try { await client.getChainId(); break; } catch { await new Promise(r => setTimeout(r, 50)); }
    if (i === 99) throw new Error('Anvil did not start');
  }
  const wallet = createWalletClient({ chain: foundry, transport: http(url) });
  const [account, other] = await wallet.getAddresses();
  const artifact = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as { abi: Abi; bytecode: Hex };
  const factoryArtifact = await artifact('node_modules/@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json');
  const managerArtifact = await artifact('node_modules/@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json');
  async function deploy(a: { abi: Abi; bytecode: Hex }, args: unknown[] = []): Promise<Address> {
    const hash = await wallet.deployContract({ account, abi: a.abi, bytecode: a.bytecode, args });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('Deploy failed');
    return receipt.contractAddress;
  }
  async function write(abi: Abi, address: Address, functionName: string, args: unknown[]) {
    const estimate = await client.estimateContractGas({ account, address, abi, functionName, args });
    const gas = (estimate * 120n + 99n) / 100n;
    const hash = await wallet.writeContract({ account, address, abi, functionName, args, gas });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`Fixture ${functionName} reverted: gasUsed=${receipt.gasUsed}; gasLimit=${gas}`);
    return receipt;
  }
  const source = await readFile('tests/fixtures/TestToken.sol', 'utf8');
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'TestToken.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  if (!compiled.contracts) throw new Error(JSON.stringify(compiled.errors));
  const token = compiled.contracts['TestToken.sol'].TestToken;
  const tokenArtifact = { abi: token.abi as Abi, bytecode: `0x${token.evm.bytecode.object}` as Hex };
  const factory = await deploy(factoryArtifact);
  const acceptance = tokenVariant === 'fixed-acceptance' ? await compileAcceptanceAssets() : null;
  const first = acceptance ? await deploy(acceptance.artifacts[0]) : await deploy(tokenArtifact, ['TEST-A']);
  const second = acceptance ? await deploy(acceptance.artifacts[1]) : await deploy(tokenArtifact, ['TEST-B']);
  const [token0, token1] = [first, second].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const manager = await deploy(managerArtifact, [factory, token0, other]);
  for (const address of [token0, token1]) {
    if (!acceptance) await write(tokenArtifact.abi, address, 'mint', [account, 10n ** 24n]);
    await write(acceptance?.artifacts[0].abi ?? tokenArtifact.abi, address, 'approve',
      [manager, acceptance ? ACCEPTANCE_DEPOSIT : 2n ** 256n - 1n]);
  }
  const initAbi = parseAbi(['function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns (address pool)',
    'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)']);
  await write(initAbi, manager, 'createAndInitializePoolIfNecessary', [token0, token1, 3000, 2n ** 96n]);
  const block = await client.getBlock();
  await write(initAbi, manager, 'mint', [{
    token0, token1, fee: 3000, tickLower: -600, tickUpper: 600,
    amount0Desired: acceptance ? ACCEPTANCE_DEPOSIT : 10n ** 21n,
    amount1Desired: acceptance ? ACCEPTANCE_DEPOSIT : 10n ** 21n, amount0Min: 0n, amount1Min: 0n,
    recipient: account, deadline: block.timestamp + 3600n,
  }]);
  // These two labels deliberately target ONE LOCAL EVM, not independent mainnet operators.
  const sources = [{ url, operator: 'local-fixture-a' }, { url, operator: 'local-fixture-b' }];
  const request: Requester = async (_source, method, params) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  };
  await client.request({ method: 'evm_mine' as never });
  await client.request({ method: 'evm_mine' as never });
  const deployment = { chainId: foundry.id, manager, factory, wrappedNative: token0 };
  const adapter = new V3Adapter(new StrictRpc(sources, request), deployment, [token0, token1]);
  return { child, account, other, manager, factory, token0, token1, tokenId: 1n, adapter, deployment, client, wallet };
}
