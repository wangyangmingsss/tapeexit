import { getAddress } from 'viem';

// Shared display scope without loading the SDK or transaction-building modules.
export const TEST_POLICY = {
  chainId: 196, tokenId: '67042',
  account: getAddress('0x101fd328a0b2fd9e853909651dab1c0b55947c03'),
  token0: getAddress('0x779Ded0c9e1022225f8E0630b35a9b54bE713736'),
  token1: getAddress('0xB6CEceAB302E2E4948951eE7843FC24E92933061'),
  pool: getAddress('0xEEeB3C1F61DC3070C675c2670a3f2188A060012D'),
  baselineLiquidity: '2000862', removeLiquidity: '20008', basisPoints: 100,
  maximumCollectionPerToken: '50000', decimals: 6, slippageBps: 50,
  gasCap: '1000000', gasPriceCapWei: '30000000',
  consent: 'MAINNET_TEST_67042_ONE_PERCENT_UNREVIEWED',
} as const;
