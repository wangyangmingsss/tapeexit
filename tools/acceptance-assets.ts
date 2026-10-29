import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { keccak256, type Abi, type Hex } from 'viem';
import { digest } from './publish-core';
import { validateSourceInput } from './runtime-match-core';

export const ACCEPTANCE_SUPPLY = 1000n * 10n ** 18n;
export const ACCEPTANCE_DEPOSIT = 10n * 10n ** 18n;
export const ACCEPTANCE_COMPILER = '0.7.6+commit.7338295f.Emscripten.clang';
export const ACCEPTANCE_OPENZEPPELIN = '3.4.2-solc-0.7';
const contracts = ['TapeExitAcceptanceA', 'TapeExitAcceptanceB'] as const;
export interface AcceptanceArtifact {
  contract: typeof contracts[number]; abi: Abi; bytecode: Hex; deployedBytecode: Hex;
  bytecodeSha256: string; runtimeCodeHash: Hex;
}

export async function compileAcceptanceAssets() {
  const require = createRequire(import.meta.url);
  const compiler = require('solc');
  if (compiler.version() !== ACCEPTANCE_COMPILER ||
      require('@openzeppelin/contracts/package.json').version !== ACCEPTANCE_OPENZEPPELIN)
    throw new Error('Acceptance assets require the exact pinned compiler and OpenZeppelin version');
  const sources: Record<string, { content: string }> = {
    'contracts/AcceptanceToken.sol': { content: await readFile('contracts/AcceptanceToken.sol', 'utf8') },
  };
  for (const path of ['token/ERC20/ERC20.sol', 'token/ERC20/IERC20.sol', 'math/SafeMath.sol', 'utils/Context.sol'])
    sources[`@openzeppelin/contracts/${path}`] = {
      content: await readFile(require.resolve(`@openzeppelin/contracts/${path}`), 'utf8'),
    };
  const input = { language: 'Solidity', sources, settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'istanbul',
    outputSelection: { '*': { '*': ['abi', 'metadata', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  } };
  validateSourceInput(input);
  const inputBytes = Buffer.from(JSON.stringify(input, null, 2) + '\n');
  // Embedded imports only; never load remote compiler or import callbacks.
  const output = JSON.parse(compiler.compile(inputBytes.toString()));
  if (output.errors?.some((error: any) => error.severity === 'error'))
    throw new Error('Acceptance asset compilation failed');
  const artifacts: AcceptanceArtifact[] = contracts.map(contract => {
    const result = output.contracts?.['contracts/AcceptanceToken.sol']?.[contract];
    const creation = result?.evm?.bytecode?.object, runtime = result?.evm?.deployedBytecode?.object;
    if (!/^(?:[a-f0-9]{2})+$/i.test(creation ?? '') || !/^(?:[a-f0-9]{2})+$/i.test(runtime ?? ''))
      throw new Error('Incomplete or unlinked acceptance asset bytecode');
    return { contract, abi: result.abi, bytecode: `0x${creation}`, deployedBytecode: `0x${runtime}`,
      bytecodeSha256: digest(Buffer.from(creation, 'hex')), runtimeCodeHash: keccak256(`0x${runtime}`) };
  });
  return { input, inputBytes, inputSha256: digest(inputBytes), compilerVersion: ACCEPTANCE_COMPILER, artifacts };
}

