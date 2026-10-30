export const PRODUCT = {
  name: 'TapeExit',
  description: '基于 TapeOut 的 X Layer DeFi 资产应急出口',
  demo: 'https://wangyangmingsss.github.io/tapeexit/',
  releases: 'https://github.com/wangyangmingsss/tapeexit/releases',
  publication: {
    name: '2.2.289.tape',
    container: '0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D',
    release: '0.2.0-0d9ff56',
    sourceCommit: '0d9ff56a32b2ce36cd78c925d03f7205c169bf4a',
    manifestSha256: 'c3c4101ae075a2dd1679213776dfc2d988494cb5c407ee58f82dc490b9a455cc',
    gateways: ['https://2-2-289.netlify.app/', 'https://2-2-289.vercel.app/'],
  },
} as const;

export const PROTOCOL_COVERAGE = [
  { id: 'uniswap-v3', name: 'Uniswap V3', status: 'readonly' },
  { id: 'v2', name: 'V2 LP', status: 'planned' },
  { id: 'staking', name: 'Staking', status: 'planned' },
  { id: 'vault', name: 'Vault', status: 'planned' },
  { id: 'lending', name: 'Lending', status: 'planned' },
] as const;
