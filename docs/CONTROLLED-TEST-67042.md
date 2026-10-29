# USDt0 / Native USDC Controlled Test

The user's current test position is Uniswap V3 #67042, directly held by
`0x101FD328a0B2Fd9E853909651dAB1c0B55947C03`. The earlier #19989 screenshot
was V4 and must not be read through the V3 manager. That older NFT is untouched.

The user requested a small real-asset project test and version update, rather
than another token deployment or extended source hunt. This explicitly separate,
unreviewed mainnet test supersedes the fixed-supply-token acceptance proposal for
this task. It does not claim commercial production readiness or independent review.

## Fixed Scope

- Chain: X Layer, 196.
- Manager: `0x315e413A11AB0df498eF83873012430ca36638Ae`.
- USDt0: `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`.
- Native USDC: `0xB6CEceAB302E2E4948951eE7843FC24E92933061`.
- Pool: `0xEEeB3C1F61DC3070C675c2670a3f2188A060012D`, fee 100 (0.01%).
- Initial liquidity: 2,000,862; removed liquidity: 20,008 (rounded-down 1%).
- Expected full-range ticks: -887272 and 887272; both decimals: 6.
- Initial owed amounts: zero.
- Recipient: the original owner only.
- Collection cap: 0.05 units of each token, encoded on-chain.
- Principal minima: existing pinned V3 SDK, 0.5% slippage, both strictly positive.
- Gas limit cap: 1,000,000; gas price cap: 30,000,000 wei.
- Native transfer value: zero; no ERC20 approval, NFT approval or account upgrade.

The production allowlist remains empty and `RELEASE_APPROVED` remains false.
The general public application does not gain a signing bypass. This tool builds
its own fixed-position, capped calldata and cannot accept arbitrary targets,
recipients, amounts or wallet RPC commands from HTTP clients.

## Verification

The tool checks the original manager/factory, full token and implementation
code hashes, implementation pointers, original owner delegation, current
USDt0 blocking, USDC pause and blacklist state at a pinned block. USDC uses
legacy `org.zeppelinos.proxy.implementation` and `.admin` slots, rather than
only ERC-1967 slots. Empty standard slots never establish a non-proxy contract.

Observed hashes are not exact source matches or an audit. Issuers retain
freeze/pause/upgrade powers. A passing current simulation does not predict
future governance or transfer behavior.

```sh
npm run verify:asset-fork -- 67042
npm run verify:test-fork
npm run test:wallet
```

`verify:test-fork` executes the actual capped 1% calldata on a disposable local
fork, checks collection events, actual balances, remaining liquidity and
finality, then reconstructs the coordinator from the saved journal and repeats
read-only verification. It also checks that another exit is blocked.
No fork result is a mainnet or real-extension acceptance result.

The wallet tool requires clean committed source and binds only
`http://127.0.0.1:4184/`. It uses the existing extension, never a new Agentic
wallet or server-side key. Source identity appears on screen.

## Actual Wallet Task

Connect the original OKX extension on X Layer, prepare the fresh 1% quote,
inspect minimum amounts, token caps, recipient, deadline and gas cost, then
explicitly consent and confirm the single transaction in the extension.
The user consent includes the absence of independent review.

The journal is persisted and fsynced before requesting a wallet transaction.
A missing response, unavailable RPC, mismatch, unfinalized receipt or arrival
discrepancy keeps the request unresolved. Never resend to recover a missing hash.
Use the wallet history to supply that exact transaction hash.
An explicit cancellation plus unchanged latest/pending nonce can release an
unhashed reservation. An existing filesystem lock is not automatically reclaimed.

Receipt checking verifies exact calldata, sender, manager, chain, nonce, settled
EVM fee, canonical finalized block, pool collection events, token transfers,
parent/receipt block balances and exact remaining liquidity. Larger unused
wallet gas envelopes do not alone fail a settled transaction within consent.
Chain-specific additional fees are not represented by the EVM gas calculation.

Restart the tool with the same journal, then use "重新核验已完成交易".
The regular application and `verify:recovery` also recognize bounded collect
amounts and can recheck the receipt without approving either asset.
The export is a public test journal, not a private key or production review.

Actual TapeOut-origin signing, gateway failure recovery and clean-device
extension recovery require separate observed tasks. The historic 733ca79
gateway release does not contain this test tool and is not silently relabeled.
