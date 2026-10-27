import { getAddress, parseAbi, type Address } from 'viem';

export const CHAIN_ID = 196;
export const MANAGER = getAddress('0x315e413A11AB0df498eF83873012430ca36638Ae');
export const FACTORY = getAddress('0x4B2ab38DBF28D31D467aA8993f6c2585981D6804');
export const WOKB = getAddress('0xe538905cf8410324e03A5A23C1c177a474D59b2b');
export const SOURCES = [
  { url: 'https://rpc.xlayer.tech', operator: 'okx' },
  { url: 'https://xlayer.drpc.org', operator: 'drpc' },
] as const;
export const managerAbi = parseAbi([
  'function factory() view returns (address)',
  'function WETH9() view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable returns (uint256 amount0,uint256 amount1)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) payable returns (uint256 amount0,uint256 amount1)',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'event DecreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
  'event Collect(uint256 indexed tokenId,address recipient,uint256 amount0,uint256 amount1)',
]);
export const factoryAbi = parseAbi([
  'function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)',
]);
export const poolAbi = parseAbi([
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)',
  'event Collect(address indexed owner,address recipient,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount0,uint128 amount1)',
]);
export const tokenAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address account) view returns (uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
export interface Deployment {
  chainId: number;
  manager: Address;
  factory: Address;
  wrappedNative: Address;
  managerCodeHash?: `0x${string}`;
  factoryCodeHash?: `0x${string}`;
}
export const DEPLOYMENT: Deployment = {
  chainId: CHAIN_ID, manager: MANAGER, factory: FACTORY, wrappedNative: WOKB,
  managerCodeHash: '0xd8339465f5c45afef4319fde20bb35cb5c5e17cf861c73b669d07ca615e3213c',
  factoryCodeHash: '0x98cde3564f540d7529feb2c697e2d79b85e3bc864d088ebe09fd5dcfc60a5c0e',
};
// Trading remains disabled until the deployment and each supported asset have
// independent review evidence. Read-only access does not imply asset approval.
export const SUPPORTED_TOKENS: readonly Address[] = [];
export const RELEASE_APPROVED = false;
export const RELEASE = typeof __RELEASE__ === 'undefined' ? '0.1.0-development' : __RELEASE__;
