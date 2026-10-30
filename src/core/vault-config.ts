import { getAddress, parseAbi } from 'viem';

// Observed through two X Layer RPC operators. These pins identify a read-only
// integration, not an independent review or permission to sign.
export const SPARK_USDC = Object.freeze({
  chainId: 196,
  protocolId: 'spark-spusdc',
  name: 'Spark Savings USDC',
  vault: getAddress('0xf90E63079D97a0A1f479b2b168457F420CAFf6ba'),
  implementation: getAddress('0xdCe929A335C75a1676EF5957A4D7a3b928C48820'),
  asset: getAddress('0xB6CEceAB302E2E4948951eE7843FC24E92933061'),
  proxyCodeHash: '0x9dc4caa1d9a88e199d6e4ceaf889a4f6c229cb265c96a3e9473d999b352afff8',
  implementationCodeHash: '0x42d7995d1b8d50e0745d706e98d3fa5104b66a62b53bab40ba7186cd6b693741',
  assetCodeHash: '0xa259d230afe44e97f1500ce5c06cd2e5bdafb129f25c104d8716470cb4fff0be',
  decimals: 6,
  registryCommit: 'a26016637516fd4475cd846800835e30cc1027a2',
  implementationSource: '0a686ba2fcf874bc1542171a323779ba73ac2dc5',
} as const);
export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const vaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function getImplementation() view returns (address)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function redeem(uint256 shares,address receiver,address owner) returns (uint256 assets)',
  'function withdraw(uint256 assets,address receiver,address owner) returns (uint256 shares)',
  'event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)',
]);
