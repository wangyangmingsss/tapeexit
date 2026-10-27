import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// solc 0.7.6 is used only to compile this isolated protocol fixture.
// @ts-expect-error The pinned compiler has no TypeScript declarations.
import solc from 'solc';
import { keccak256, type Hex } from 'viem';
import { StrictRpc } from '../src/core/rpc';
import { BINDING, REGISTRY, digest, encodePublishFile, fallbackTransaction } from '../tools/publish-core';
import { startLocalEvm } from '../tools/local-evm';
import { rehearseOperations } from '../tools/rehearse-publication-core';
import { resumePublication } from '../tools/resume-publication-core';
import { verifyPublication } from '../tools/verify-publication-core';

const publisher = '0x1000000000000000000000000000000000000001';
const container = '0x2000000000000000000000000000000000000002';
// Explicit registry protocol fixture, not TapeOut deployment or authorization evidence.
const source = `pragma solidity =0.7.6; pragma abicoder v2;
contract RegistryFixture {
  struct File { bytes data; string mime; bytes32 hash; uint chunks; bool exists; }
  mapping(address => mapping(string => File)) files;
  mapping(address => string[]) paths; mapping(address => string) fallbackPaths;
  function putFile(address c,string memory p,string memory mime,bytes32 hash,bytes memory data) public {
    require(!files[c][p].exists, "exists"); paths[c].push(p);
    files[c][p] = File(data,mime,hash,1,true);
  }
  function appendChunk(address c,string memory p,uint index,bytes memory data) public {
    File storage f = files[c][p]; require(f.exists && f.chunks == index, "index");
    for(uint i=0;i<data.length;i++) f.data.push(data[i]); f.chunks++;
  }
  function setFallback(address c,string memory p) public { require(files[c][p].exists, "missing"); fallbackPaths[c]=p; }
  function pathCount(address c) public view returns(uint) { return paths[c].length; }
  function pathsRange(address c,uint start,uint count) public view returns(string[] memory result) {
    result=new string[](count); for(uint i=0;i<count;i++) result[i]=paths[c][start+i];
  }
  function fallbackPath(address c) public view returns(string memory) { return fallbackPaths[c]; }
  function fileInfo(address c,string memory p) public view returns(uint,string memory,bytes32,uint,uint) {
    File storage f=files[c][p]; return(f.data.length,f.mime,f.hash,0,f.chunks);
  }
  function readRange(address c,string memory p,uint offset,uint length) public view returns(bytes memory result) {
    result=new bytes(length); for(uint i=0;i<length;i++) result[i]=files[c][p].data[offset+i];
  }
  function isContainerLive(address) public pure returns(bool) { return false; }
}`;
const bytes = Buffer.alloc(24_001, 1);
const contents = [
  { bytes, file: { path: 'assets/app.js', contentType: 'text/javascript', size: bytes.length, sha256: digest(bytes) } },
  ...['release-manifest.json', 'index.html'].map(path => {
    const bytes = Buffer.from(path);
    return { bytes, file: { path, contentType: path.endsWith('.json') ? 'application/json' : 'text/html',
      size: bytes.length, sha256: digest(bytes) } };
  }),
];
const publication = { contents, manifestSha256: contents[1].file.sha256 };
const operations = [...contents.flatMap(c => encodePublishFile(container, c.file, c.bytes)), fallbackTransaction(container)];
const profile = { schemaVersion: 1, chainId: 196, publisher, container, circuitId: '1', processorIndex: '2',
  maxGasPerTransaction: '25000000', maxFeePerGasWei: '100000000000', maxUploadCostWei: '12500000000000000000',
  expectedCodeHashes: Object.fromEntries(['processor', 'container', 'opener', 'registry', 'binding', 'factory']
    .map(key => [key, keccak256('0x6000')])) };

describe('disposable publication EVM and sequential runner', () => {
  let evm: Awaited<ReturnType<typeof startLocalEvm>>, checkpoint: unknown, rpc: StrictRpc;
  beforeAll(async () => {
    evm = await startLocalEvm();
    const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity',
      sources: { 'Fixture.sol': { content: source } },
      settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } } },
    })));
    if (compiled.errors?.some((e: { severity: string }) => e.severity === 'error'))
      throw new Error(JSON.stringify(compiled.errors));
    const code: Hex = `0x${compiled.contracts['Fixture.sol'].RegistryFixture.evm.deployedBytecode.object}`;
    await evm.request('anvil_setCode', [REGISTRY, code]);
    await evm.request('anvil_setCode', [BINDING, code]);
    rpc = new StrictRpc([{ url: 'http://127.0.0.1', operator: 'same-local-a' },
      { url: 'http://127.0.0.1', operator: 'same-local-b' }], (_s, m, p) => evm.request(m, p));
  });
  beforeEach(async () => { checkpoint = await evm.request('evm_snapshot'); });
  afterEach(async () => { await evm?.request('evm_revert', [checkpoint]); });
  afterAll(async () => { await evm?.close(); });
  it('executes dependent chunks and fallback, then verifies all actual EVM bytes', async () => {
    const result = await rehearseOperations(evm.request, profile, operations);
    expect(result.receipts).toHaveLength(5);
    expect(BigInt(result.simulatedUploadCostWei)).toBeGreaterThan(0n);
    expect(result.receipts[1]).toMatchObject({ file: 'assets/app.js', chunk: 1 });
    await evm.request('evm_mine'); await evm.request('evm_mine');
    const report = await verifyPublication(rpc, container, publication, publication.manifestSha256);
    expect(report.files).toHaveLength(3);
    expect(report.files[0].chunks).toBe('2');
    expect(report.containerLive).toBe(false);
  });
  it('resumes after a real committed first chunk without overwriting it', async () => {
    await rehearseOperations(evm.request, profile, operations.slice(0, 1));
    await evm.request('evm_mine'); await evm.request('evm_mine');
    const plan = await resumePublication(rpc, container, publication);
    expect(plan.transactions).toEqual(operations.slice(1));
    await rehearseOperations(evm.request, profile, plan.transactions);
    await evm.request('evm_mine'); await evm.request('evm_mine');
    expect((await verifyPublication(rpc, container, publication, publication.manifestSha256)).files).toHaveLength(3);
  });
  it('stops an out of order append before submitting it', async () => {
    let sends = 0;
    await expect(rehearseOperations(async (method, params) => {
      if (method === 'eth_sendTransaction') sends++;
      return evm.request(method, params);
    }, profile, [operations[1]])).rejects.toThrow();
    expect(sends).toBe(0);
  });
  it('rejects missing operations, another container, target and value before local writes', async () => {
    for (const ops of [[], [{ ...operations[0], to: publisher as Hex }],
      [{ ...operations[0], value: '1' as '0' }]]) {
      let calls = 0;
      await expect(rehearseOperations(async () => { calls++; }, profile, ops)).rejects.toThrow();
      expect(calls).toBe(0);
    }
    await expect(rehearseOperations(evm.request, { ...profile, container: publisher }, operations)).rejects.toThrow('container');
  });
  it('checks chain, fee, total ceiling and per operation estimate before sending', async () => {
    for (const patch of [{ chain: true }, { maxFeePerGasWei: '1' }, { maxUploadCostWei: '1' },
      { maxGasPerTransaction: '21000' }]) {
      let sends = 0;
      await expect(rehearseOperations(async (method, params) => {
        if (method === 'eth_chainId' && 'chain' in patch) return '0x1';
        if (method === 'eth_sendTransaction') sends++;
        return evm.request(method, params);
      }, { ...profile, ...patch }, operations)).rejects.toThrow();
      expect(sends).toBe(0);
    }
  });
  it('does not retry an unknown send result or continue to later operations', async () => {
    let sends = 0;
    await expect(rehearseOperations(async (method, params) => {
      const result = await evm.request(method, params);
      if (method === 'eth_sendTransaction') { sends++; throw new Error('response lost'); }
      return result;
    }, profile, operations)).rejects.toThrow('response lost');
    expect(sends).toBe(1);
  });
  it('stops on missing, reverted or mismatched receipt and never sends the next chunk', async () => {
    for (const patch of [null, { status: '0x0' }, { transactionHash: `0x${'00'.repeat(32)}` },
      { effectiveGasPrice: '0x0' }, { gasUsed: '0x' }]) {
      const snap = await evm.request('evm_snapshot');
      let sends = 0;
      await expect(rehearseOperations(async (method, params) => {
        const result = await evm.request(method, params);
        if (method === 'eth_sendTransaction') sends++;
        if (method === 'eth_getTransactionReceipt') return patch === null ? null : { ...result as object, ...patch };
        return result;
      }, profile, operations)).rejects.toThrow();
      expect(sends).toBe(1);
      await evm.request('evm_revert', [snap]);
    }
  });
  it('checks mined input, sender, target, value, gas and canonical block', async () => {
    for (const patch of [{ input: '0x00' }, { from: container }, { to: publisher }, { value: '0x1' },
      { gas: '0x1' }, { blockHash: `0x${'00'.repeat(32)}` }, { blockNumber: '0x0' }]) {
      const snap = await evm.request('evm_snapshot');
      let sends = 0;
      await expect(rehearseOperations(async (method, params) => {
        const result = await evm.request(method, params);
        if (method === 'eth_sendTransaction') sends++;
        return method === 'eth_getTransactionByHash' ? { ...result as object, ...patch } : result;
      }, profile, operations)).rejects.toThrow('mismatch');
      expect(sends).toBe(1);
      await evm.request('evm_revert', [snap]);
    }
  });
});
