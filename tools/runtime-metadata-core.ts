import { keccak256, type Hex } from 'viem';

/** Recognizes only the complete legacy Solidity bzzr0 CBOR trailer; never infers a compiler version. */
export function inspectLegacyMetadata(runtime: unknown) {
  if (typeof runtime !== 'string' || !/^0x(?:[a-f0-9]{2})+$/i.test(runtime))
    throw new Error('Nonempty complete runtime bytes required');
  const bytes = Buffer.from(runtime.slice(2), 'hex');
  const length = bytes.length >= 2 ? bytes.readUInt16BE(bytes.length - 2) : 0;
  const trailer = length && length + 2 < bytes.length ? bytes.subarray(bytes.length - length - 2, -2) : null;
  const legacy = trailer?.length === 41 && trailer.subarray(0, 9).toString('hex') === 'a165627a7a72305820';
  return {
    runtimeBytes: bytes.length, runtimeCodeHash: keccak256(runtime as Hex),
    format: legacy ? 'SOLIDITY_LEGACY_BZZR0' : 'UNRECOGNIZED',
    metadataBytes: legacy ? length : null,
    metadataContentHash: legacy ? trailer!.subarray(9).toString('hex') : null,
    compilerVersion: null, sourceCorrespondence: 'NOT_ESTABLISHED',
    metadataStripped: false, signingApproved: false,
    limitations: 'The bzzr0 hash identifies legacy Swarm metadata content, not Solidity source or compiler. ' +
      'A trailer alone does not prove provenance or reproducible bytecode correspondence.',
  } as const;
}
