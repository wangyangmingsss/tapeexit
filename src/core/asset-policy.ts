import { CHAIN_ID, EXCLUDED_ASSETS } from '../config';
import type { Address } from 'viem';

export function isExcludedAsset(address: Address, chainId = CHAIN_ID) {
  return chainId === CHAIN_ID && EXCLUDED_ASSETS.some(asset => asset.toLowerCase() === address.toLowerCase());
}
