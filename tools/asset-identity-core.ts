import { getAddress, zeroAddress } from 'viem';
import type { Block } from '../src/core/rpc';
import { digest } from './publish-core';
import type { inspectAssets } from './operations-core';

type Report = Awaited<ReturnType<typeof inspectAssets>>;
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function assetIdentity(asset: Report['assets'][number]) {
  const proxy = asset.proxy;
  if (!proxy || proxy.schemaVersion !== 1 || proxy.root !== asset.address ||
      !Array.isArray(proxy.nodes) || !proxy.nodes.length || proxy.nodes.length > 12 ||
      !Array.isArray(proxy.edges) || proxy.edges.length > 36 || !sha(proxy.identitySha256))
    throw new Error('Asset baseline requires complete proxy observations; recollect older reports');
  const graph = { schemaVersion: 1, root: proxy.root, nodes: proxy.nodes, edges: proxy.edges };
  if (digest(Buffer.from(JSON.stringify(graph))) !== proxy.identitySha256 ||
      proxy.nodes.find(node => node.address === asset.address)?.codeHash !== asset.codeHash)
    throw new Error('Asset proxy observation digest or root code mismatch');
  if (getAddress(asset.address) === zeroAddress || getAddress(asset.address) !== asset.address ||
      typeof asset.codeHash !== 'string' || !/^0x[a-f0-9]{64}$/i.test(asset.codeHash) ||
      !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36 ||
      typeof asset.symbol !== 'string' || asset.symbol.length > 24 ||
      asset.approval !== 'NOT_APPROVED' || asset.behavior !== 'NOT_ASSESSED')
    throw new Error('Invalid candidate asset identity');
  return { codeHash: asset.codeHash, decimals: asset.decimals, symbol: asset.symbol,
    proxyIdentity: proxy.identitySha256 };
}
export function parseAssetBaseline(bytes: Uint8Array, expectedSha256: string): Report {
  if (!sha(expectedSha256) || bytes.length > 2 * 1024 * 1024 || digest(bytes) !== expectedSha256)
    throw new Error('Independently saved asset baseline digest mismatch or oversized input');
  const report = JSON.parse(Buffer.from(bytes).toString()) as Report;
  assertReport(report);
  return report;
}
function assertReport(report: Report) {
  if (!report || report.schemaVersion !== 1 || report.chainId !== 196 || report.status !== 'candidate-metadata-only' ||
      !report.block || !/^0x(?:0|[1-9a-f][a-f0-9]{0,63})$/i.test(report.block.number) ||
      !/^0x(?:0|[1-9a-f][a-f0-9]{0,63})$/i.test(report.block.timestamp) ||
      !/^0x[a-f0-9]{64}$/i.test(report.block.hash) ||
      !Array.isArray(report.assets) || !report.assets.length || report.assets.length > 20)
    throw new Error('Invalid candidate baseline report');
  for (const asset of report.assets) assetIdentity(asset);
  if (new Set(report.assets.map(asset => asset.address)).size !== report.assets.length)
    throw new Error('Duplicate asset baseline address');
}
export function compareAssetIdentities(baseline: Report, current: Report) {
  assertReport(baseline); assertReport(current);
  if (BigInt(current.block.number) < BigInt(baseline.block.number) ||
      BigInt(current.block.number) === BigInt(baseline.block.number) && current.block.hash !== baseline.block.hash ||
      current.assets.length !== baseline.assets.length)
    throw new Error('Asset recheck is older than baseline or has a different address set');
  const before = new Map(baseline.assets.map(asset => [asset.address, assetIdentity(asset)]));
  const differences = [];
  for (const asset of current.assets) {
    const old = before.get(asset.address), observed = assetIdentity(asset);
    if (!old) throw new Error('Asset recheck has a different address set');
    for (const field of ['codeHash', 'decimals', 'symbol', 'proxyIdentity'] as const)
      if (old[field] !== observed[field])
        differences.push({ address: asset.address, field, before: old[field], after: observed[field] });
  }
  return { status: differences.length ? 'ASSET_IDENTITY_CHANGED' : 'OBSERVED_IDENTITY_UNCHANGED',
    differences, approval: 'NOT_APPROVED', behavior: 'NOT_ASSESSED',
    baselineBlock: baseline.block as Block, currentBlock: current.block as Block,
    scope: 'Current observations compared with a caller-trusted baseline; no asset approval or behavior guarantee. ' +
      'Standard slots and sampled beacon calls do not prove every execution path or governance. ' +
      'Changes between observations or after this block are not ruled out.' };
}
