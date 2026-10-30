export const PRODUCT = {
  name: 'TapeExit',
  description: '基于 TapeOut 的 X Layer DeFi 资产应急出口',
  demo: 'https://wangyangmingsss.github.io/tapeexit/',
  releases: 'https://github.com/wangyangmingsss/tapeexit/releases',
  publication: {
    name: '2.2.289.tape',
    container: '0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D',
    release: '0.3.0-2597f66',
    sourceCommit: '2597f667dd0fcaefc416dd66e9cf513d75ef78d4',
    manifestSha256: '3108213d676a2f4cbee87943d8be031e1dcf880077f4c847618568e85b9c190a',
    gateways: ['https://2-2-289.netlify.app/', 'https://2-2-289.vercel.app/'],
  },
} as const;

export const PROTOCOL_COVERAGE = [
  { id: 'uniswap-v3', name: 'Uniswap V3', status: 'readonly' },
  { id: 'v2', name: 'V2 LP', status: 'planned' },
  { id: 'staking', name: 'Staking', status: 'planned' },
  { id: 'spark-spusdc', name: 'Spark Savings USDC', status: 'readonly' },
  { id: 'lending', name: 'Lending', status: 'planned' },
] as const;
