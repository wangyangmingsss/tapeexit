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
import { PublicationWorkbench, type UploadJournal, type UploadPreview } from '../tools/publication-workbench-core';
import { IMPL_SLOT, IMPLEMENTATIONS, OPENER, TAPE_FACTORY } from '../tools/operations-core';

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
  function cpuAt(uint) public pure returns(address) { return address(0x3000000000000000000000000000000000000003); }
  function isCPU(address a) public pure returns(bool) { return a == address(0x3000000000000000000000000000000000000003); }
  function accountOf(address,uint) public pure returns(address) { return address(0x2000000000000000000000000000000000000002); }
  function isOpened(address,uint) public pure returns(bool) { return true; }
  function ownerOf(uint) public pure returns(address) { return address(0x1000000000000000000000000000000000000001); }
  function token() public pure returns(uint,address,uint) { return (196,address(0x3000000000000000000000000000000000000003),1); }
  function monthlyFee() public pure returns(uint) { return 0; }
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
  let evm: Awaited<ReturnType<typeof startLocalEvm>>, checkpoint: unknown, rpc: StrictRpc, fixtureCodeHash: Hex;
  beforeAll(async () => {
    evm = await startLocalEvm();
    const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity',
      sources: { 'Fixture.sol': { content: source } },
      settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.deployedBytecode.object'] } } },
    })));
    if (compiled.errors?.some((e: { severity: string }) => e.severity === 'error'))
      throw new Error(JSON.stringify(compiled.errors));
    const code: Hex = `0x${compiled.contracts['Fixture.sol'].RegistryFixture.evm.deployedBytecode.object}`;
    fixtureCodeHash = keccak256(code);
    for (const address of [REGISTRY, BINDING, TAPE_FACTORY, OPENER, container,
      '0x3000000000000000000000000000000000000003', ...Object.values(IMPLEMENTATIONS)])
      await evm.request('anvil_setCode', [address, code]);
    for (const [address, implementation] of [[REGISTRY, IMPLEMENTATIONS.registry],
      [BINDING, IMPLEMENTATIONS.binding], [TAPE_FACTORY, IMPLEMENTATIONS.factory]])
      await evm.request('anvil_setStorageAt', [address, IMPL_SLOT, `0x${implementation.slice(2).padStart(64, '0')}`]);
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
  it('runs the browser publication coordinator against actual disposable EVM receipts and resumes after restart', async () => {
    const input = { ...profile, expectedCodeHashes: Object.fromEntries(Object.keys(profile.expectedCodeHashes)
      .map(name => [name, fixtureCodeHash])) };
    const contextId = PublicationWorkbench.contextId(input, publication.manifestSha256);
    let saved: UploadJournal = { schemaVersion: 1, contextId, authorization: null, attempts: [] };
    const store = { save: async (j: UploadJournal) => { saved = structuredClone(j); } };
    let bench = new PublicationWorkbench(rpc, input, publication, structuredClone(saved), store);
    await evm.request('anvil_setBalance', [publisher, '0x56bc75e2d63100000']);
    await evm.request('anvil_impersonateAccount', [publisher]);
    await evm.request('evm_mine'); await evm.request('evm_mine'); await evm.request('evm_mine');
    await bench.authorize(contextId, input.maxUploadCostWei);
    for (let i = 0; i < operations.length; i++) {
      const preview = await bench.prepareNext() as UploadPreview;
      expect(preview.operation).toBe(i);
      const attempt = await bench.reserve(preview.id);
      // This is an explicit local fixture wallet. The coordinator never sends.
      const hash = await evm.request('eth_sendTransaction', [attempt.transaction]);
      bench = new PublicationWorkbench(rpc, input, publication, structuredClone(saved), store);
      await expect(bench.prepareNext()).rejects.toThrow('unresolved');
      await bench.attachHash(attempt.id, hash);
      await evm.request('evm_mine'); await evm.request('evm_mine');
      await bench.reconcile();
      expect(bench.context().attempts.at(-1)?.status).toBe('confirmed');
    }
    expect(await bench.prepareNext()).toMatchObject({ complete: true,
      readback: { status: 'published-bytes-checked', containerLive: false } });
    expect(saved.attempts).toHaveLength(operations.length);
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
  it('executes zero-price transactions in a zero-base-fee local EVM with an explicit zero fee budget', async () => {
    await evm.request('anvil_setNextBlockBaseFeePerGas', ['0x0']);
    await evm.request('evm_mine');
    const result = await rehearseOperations((method, params) =>
      method === 'eth_gasPrice' ? Promise.resolve('0x0') : evm.request(method, params),
    { ...profile, maxFeePerGasWei: '0', maxUploadCostWei: '0' }, operations);
    expect(result.receipts).toHaveLength(5);
    expect(result.simulatedUploadCostWei).toBe('0');
    expect(result.receipts.every(r => r.effectiveGasPriceWei === '0')).toBe(true);
    expect(BigInt(result.totalGas)).toBeGreaterThan(0n);
    await evm.request('evm_mine'); await evm.request('evm_mine');
    expect((await verifyPublication(rpc, container, publication, publication.manifestSha256)).files).toHaveLength(3);
  });
  it('rejects a positive quote against a zero fee ceiling before any send', async () => {
    let sends = 0;
    await expect(rehearseOperations(async (method, params) => {
      if (method === 'eth_sendTransaction') sends++;
      return evm.request(method, params);
    }, { ...profile, maxFeePerGasWei: '0', maxUploadCostWei: '0' }, operations)).rejects.toThrow('price exceeds');
    expect(sends).toBe(0);
  });
  it('uses an explicit observed upstream price instead of the local fee suggestion', async () => {
    await evm.request('anvil_setNextBlockBaseFeePerGas', ['0x0']);
    await evm.request('evm_mine');
    const result = await rehearseOperations((method, params) =>
      method === 'eth_gasPrice' ? Promise.resolve('0x77359400') : evm.request(method, params),
    { ...profile, maxFeePerGasWei: '21000000' }, operations, 21_000_000n);
    expect(result.receipts.every(r => r.effectiveGasPriceWei === '21000000')).toBe(true);
    expect(BigInt(result.simulatedUploadCostWei)).toBe(BigInt(result.totalGas) * 21_000_000n);
  });
  it('rejects invalid observed prices before local funding or sends', async () => {
    for (const price of [-1n, 1n << 256n]) {
      let writes = 0;
      await expect(rehearseOperations(async (method, params) => {
        if (method.startsWith('anvil_') || method === 'eth_sendTransaction') writes++;
        return evm.request(method, params);
      }, profile, operations, price)).rejects.toThrow('Invalid observed gas price');
      expect(writes).toBe(0);
    }
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
