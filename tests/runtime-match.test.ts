import { describe, expect, it } from 'vitest';
import { compareCompiledRuntime, validateSourceInput } from '../tools/runtime-match-core';

describe('full compiled runtime comparison', () => {
  it('requires every byte including compiler metadata', () => {
    expect(compareCompiledRuntime('6000a100', '0x6000A100')).toMatchObject({
      exact: true, metadataStripped: false, approval: 'NOT_APPROVED',
    });
    expect(compareCompiledRuntime('6000a100', '0x6000a101')).toMatchObject({
      exact: false, status: 'RUNTIME_MISMATCH',
    });
    expect(compareCompiledRuntime('6000', '0x600000').exact).toBe(false);
  });
  it.each(['', '0x6000', '0', '__$library$__', null])('rejects incomplete or linked runtime %s', value => {
    expect(() => compareCompiledRuntime(value, '0x6000')).toThrow();
  });
  it.each(['0x', '6000', '0x0', null])('rejects missing on-chain runtime %s', value => {
    expect(() => compareCompiledRuntime('6000', value)).toThrow();
  });
  it('requires embedded standard JSON and refuses external compiler imports', () => {
    expect(() => validateSourceInput({ language: 'Solidity', sources: {
      'Token.sol': { content: 'contract Token {}' },
    }, settings: {} })).not.toThrow();
    for (const sources of [{}, [], { 'a.sol': { urls: ['https://example.com'] } },
      { 'a.sol': { content: '', urls: ['https://example.com'] } }])
      expect(() => validateSourceInput({ language: 'Solidity', sources, settings: {} })).toThrow();
  });
});
