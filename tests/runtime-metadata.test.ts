import { expect, it } from 'vitest';
import { inspectLegacyMetadata } from '../tools/runtime-metadata-core';

const hash = '1acd4c242aa9e7d3204e3739c65c4f1f467447774834e66773b0ac0e7b3dfe9e';
it('extracts a complete legacy Swarm metadata pointer without inferring source or compiler', () => {
  expect(inspectLegacyMetadata(`0x600000a165627a7a72305820${hash}0029`)).toMatchObject({
    format: 'SOLIDITY_LEGACY_BZZR0', metadataContentHash: hash, metadataBytes: 41,
    compilerVersion: null, sourceCorrespondence: 'NOT_ESTABLISHED', metadataStripped: false, signingApproved: false,
  });
});
it.each([
  '0x6000', `0xa165627a7a72305820${hash}0029`, `0x6000a165627a7a72305820${hash}0028`,
  `0x6000a165627a7a72305821${hash}0029`, `0x6000a165627a7a72305820${hash}ffff`,
])('does not treat arbitrary or malformed bytes as legacy metadata %s', code => {
  expect(inspectLegacyMetadata(code)).toMatchObject({ format: 'UNRECOGNIZED', metadataContentHash: null });
});
it.each(['0x', '', null, '0x123', '0xzz'])('rejects invalid runtime %s', code => {
  expect(() => inspectLegacyMetadata(code)).toThrow();
});
