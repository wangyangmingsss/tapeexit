import { keccak256, type Hex } from 'viem';
import { digest } from './publish-core';

export function compareCompiledRuntime(compiled: unknown, runtime: unknown) {
  if (typeof compiled !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(compiled) ||
      typeof runtime !== 'string' || !/^0x(?:[a-f0-9]{2})+$/i.test(runtime))
    throw new Error('Require complete nonempty runtime bytecode; unresolved libraries are not accepted');
  const expected = `0x${compiled.toLowerCase()}` as Hex;
  const observed = runtime.toLowerCase() as Hex;
  const exact = expected === observed;
  return { status: exact ? 'EXACT_RUNTIME_MATCH' : 'RUNTIME_MISMATCH',
    exact, compiledCodeHash: keccak256(expected), observedCodeHash: keccak256(observed),
    compiledBytes: compiled.length / 2, observedBytes: (runtime.length - 2) / 2,
    metadataStripped: false, approval: 'NOT_APPROVED' } as const;
}

export function validateSourceInput(input: unknown): asserts input is Record<string, any> {
  const value = input as Record<string, any>;
  if (!value || value.language !== 'Solidity' || !value.sources ||
      typeof value.sources !== 'object' || Array.isArray(value.sources) ||
      !Object.keys(value.sources).length || Object.keys(value.sources).length > 500 ||
      !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings))
    throw new Error('Solidity standard JSON with explicit sources and settings required');
  for (const source of Object.values(value.sources) as any[])
    if (!source || typeof source.content !== 'string' || Object.keys(source).some(key => key !== 'content'))
      throw new Error('Use embedded source content only; compiler URL/import callbacks are disabled');
}
export function sourceDigest(bytes: Uint8Array) { return digest(bytes); }
