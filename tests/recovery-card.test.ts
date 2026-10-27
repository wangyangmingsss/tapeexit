import { describe, expect, it } from 'vitest';
import { MANAGER, RELEASE } from '../src/config';
import { importRecoveryCard, recoveryCard, type RecoveryIdentity } from '../src/core/storage';

const large = (2n ** 256n - 1n).toString();
const identity: RecoveryIdentity = { manifestSha256: 'ab'.repeat(32), tapeName: '12.2.0.tape',
  container: '0x1000000000000000000000000000000000000001',
  gateways: ['https://primary.example/app/', 'https://backup.example/app/'] };
const base = { schemaVersion: 1, app: 'TapeExit', chainId: 196, manager: MANAGER, tokenIds: ['12', large] };
describe('public recovery card schema', () => {
  it('round-trips every position and optional identity without changing large integers', () => {
    const card = recoveryCard(['12', large], identity);
    expect(importRecoveryCard(JSON.stringify(card))).toEqual({ ...base, releaseId: RELEASE, ...identity });
    expect(card.tokenIds).toEqual(['12', large]);
  });
  it('accepts old minimal cards and empty public drafts', () => {
    expect(importRecoveryCard(JSON.stringify(base))).toEqual(base);
    expect(recoveryCard('')).toMatchObject({ tokenIds: [] });
    expect(recoveryCard([])).toMatchObject({ tokenIds: [] });
    expect(recoveryCard('00012').tokenIds).toEqual([]);
  });
  it('accepts at most 50 unique canonical uint256 IDs and copies arrays', () => {
    const ids = Array.from({ length: 50 }, (_, i) => String(i));
    const card = recoveryCard(ids, identity);
    ids[0] = '999';
    identity.gateways!.push('https://third.example/');
    expect(card.tokenIds[0]).toBe('0');
    expect(card.gateways).toHaveLength(2);
    identity.gateways!.pop();
  });
  it.each([
    { tokenIds: ['12', '12'] }, { tokenIds: ['01'] }, { tokenIds: [12] }, { tokenIds: ['-1'] },
    { tokenIds: [(2n ** 256n).toString()] }, { tokenIds: Array.from({ length: 51 }, (_, i) => String(i)) },
    { tokenIds: null }, { chainId: '196' }, { schemaVersion: 2 }, { app: 'Other' },
    { manager: '0x1234' }, { manager: '0x1000000000000000000000000000000000000001' },
    { releaseId: null }, { releaseId: '' }, { releaseId: ' x' }, { releaseId: 'x\nx' },
    { releaseId: 'x'.repeat(97) }, { manifestSha256: 'AB'.repeat(32) }, { manifestSha256: null },
    { manifestSha256: '0x' + 'ab'.repeat(32) }, { tapeName: 'name/other.tape' }, { tapeName: 'x\nx' },
    { tapeName: 'x'.repeat(254) }, { container: '0x1234' }, { container: '0x' + '0'.repeat(40) },
    { gateways: null }, { gateways: 'https://a.example' }, { gateways: ['http://a.example'] },
    { gateways: ['javascript:alert(1)'] }, { gateways: ['https://user:pass@a.example'] },
    { gateways: ['https://a.example/#fragment'] }, { gateways: ['https://a.example', 'https://a.example/'] },
    { gateways: Array.from({ length: 5 }, (_, i) => `https://${i}.example/`) },
    { recipient: MANAGER }, { calldata: '0x1234' }, { __proto__: null, privateKey: 'never-accepted' },
  ])('rejects malformed, duplicate or unsafe public fields %j', change => {
    expect(() => importRecoveryCard(JSON.stringify({ ...base, ...change })))
      .toThrowError(expect.objectContaining({ code: 'IMPORT' }));
  });
  it.each(['{', 'null', '[]', '"text"', ' '.repeat(16001)])('rejects malformed or oversized input', text => {
    expect(() => importRecoveryCard(text)).toThrowError(expect.objectContaining({ code: 'IMPORT' }));
  });
  it.each(['manager', 'recipient', 'chainId', 'releaseId', 'tokenIds', 'calldata'])(
    'does not let exporter identity override %s', key => {
      expect(() => recoveryCard('12', { [key]: 'unsafe' } as RecoveryIdentity))
        .toThrowError(expect.objectContaining({ code: 'IMPORT' }));
    });
});
