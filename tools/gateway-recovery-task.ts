import { getAddress, zeroAddress } from 'viem';
import { parseTokenId } from '../src/core/token-id';
import type { inspectRecoveryOutcome } from '../src/core/recovery-outcome';

export interface GatewayRecoveryTask {
  tokenId: string; account: string; hash: string;
  remainingLiquidity: string;
  assets: { address: string; decimals: number; delta: string }[];
}
export function parseGatewayRecoveryTask(input: unknown): GatewayRecoveryTask {
  const v = input as GatewayRecoveryTask;
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
      Object.keys(v).sort().join(',') !== 'account,assets,hash,remainingLiquidity,tokenId' ||
      typeof v.tokenId !== 'string' || typeof v.account !== 'string' || getAddress(v.account) === zeroAddress ||
      !/^0x[0-9a-f]{64}$/i.test(v.hash) || /^0x0{64}$/i.test(v.hash) ||
      !/^(0|[1-9][0-9]*)$/.test(v.remainingLiquidity) || !Array.isArray(v.assets) || v.assets.length !== 2)
    throw new Error('Invalid read-only gateway recovery task');
  parseTokenId(v.tokenId);
  const assets = v.assets.map(asset => {
    if (!asset || typeof asset.address !== 'string' || getAddress(asset.address) === zeroAddress ||
        !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36 ||
        !/^(0|[1-9][0-9]*)$/.test(asset.delta))
      throw new Error('Invalid expected recovery asset');
    return { ...asset, address: getAddress(asset.address) };
  });
  if (new Set(assets.map(a => a.address)).size !== 2) throw new Error('Duplicate recovery assets');
  return { tokenId: v.tokenId, account: getAddress(v.account), hash: v.hash.toLowerCase(),
    remainingLiquidity: v.remainingLiquidity, assets };
}
export function assertGatewayRecoveryTask(task: GatewayRecoveryTask, input: unknown) {
  const v = input as { schemaVersion: number; environment: string; signingApproved: boolean;
    observedAt: string; outcome: Awaited<ReturnType<typeof inspectRecoveryOutcome>> };
  const o = v?.outcome;
  if (v?.schemaVersion !== 1 || v.environment !== 'MAINNET_READ_ONLY' || v.signingApproved !== false ||
      !Number.isFinite(Date.parse(v.observedAt)) || Date.now() - Date.parse(v.observedAt) > 300000 ||
      Date.parse(v.observedAt) > Date.now() + 60000 ||
      o?.state !== 'block-state-matched' || o.hash !== task.hash || o.tokenId !== task.tokenId ||
      getAddress(o.account) !== task.account || !o.receipt.finalized || !o.identityMatches ||
      !o.liquidity.matches || o.liquidity.after !== task.remainingLiquidity ||
      !o.owed.cleared || o.balances.length !== 2 ||
      !task.assets.every(a => o.balances.some(b => getAddress(b.address) === a.address &&
        b.decimals === a.decimals && b.delta === a.delta && b.receiptAmount === a.delta && b.matches)))
    throw new Error('Gateway did not complete the expected finalized read-only recovery task');
  return v;
}
