# Replacement Acceptance Pair

WOKB source collection is no longer the release's acceptance path. WOKB remains
in deployment identity checks because the original manager exposes WETH9(), but
the replacement path never calls WOKB, unwraps it or trades against it.
WOKB positions remain visible and historical receipts remain readable. New plans,
plan validation and release asset declarations reject WOKB even if a supplied
asset record claims verification. The existing position is not closed or moved.

## What The Replacement Proves

Two fixed-supply ERC-20 acceptance assets use the exact pinned OpenZeppelin
3.4.2-solc-0.7 implementation and solc 0.7.6. Each constructor issues 1000 tokens
to its deployment sender. The only custom operation is this constructor mint.
There is no external mint, owner, pause, issuer blocklist, proxy or unwrap path.
Each name explicitly says "No Monetary Value".

This tests official V3 mechanics with source we can fully reproduce. These
tokens are not stablecoins, money, collateral or an investment. A successful
task does not qualify USDt0, WOKB or any other commercial asset for release.
It does not establish that a real-valued position is recoverable under all issuer
controls. It must be labelled a protocol acceptance task in presentations.

## Prepare Exact Sources

```sh
npm ci
npm run prepare:acceptance-assets
```

The new directory contains embedded standard JSON input, exact compiler version,
source/lock digests, ABI, creation bytecode and FULL runtime including metadata
for each contract. Existing directories are not overwritten. Dirty source is
explicitly labelled; only a clean committed candidate is suitable for handoff.
The compiler never downloads imports or another compiler. Constructor arguments
are empty. Deployed supply belongs to the wallet that deploys each contract.

The preparation command does not contact a wallet, deploy, approve assets or
change production signing. A compiled artifact is not a deployment receipt or
independent audit. Use `verify:runtime-source` with the package's input digest and
exact compiler to compare a future deployment at a fixed actual chain block.

## Mainnet Task Sequence

This is a proposed task sequence, not permission to execute it. The actual
independent reviewer must review this source, the application, setup steps and
the eventual executable release. Deployment and setup are separate from the
currently disabled production exit path.

1. Review the prepared sources and exact build. Confirm the original wallet,
   chain 196, two deployment requests, fresh gas estimates, fee ceilings and
   authorization expiry. Do not send native value with either constructor.
2. Deploy A and B separately through the existing OKX extension. Verify each
   actual creation input, sender, successful receipt, contract address, fixed
   supply, initial holder and full runtime. No addresses or transaction hashes
   exist until these steps succeed; do not invent them.
3. Verify the original manager/factory at a pinned block. Sort token addresses
   numerically. Propose a 3000-fee pool at sqrtPriceX96 = 2^96 (one acceptance
   token for the other). If a pool already exists, inspect its identity and
   price; stop if it differs, rather than assuming it has the expected state.
4. For each token, approve exactly 10 tokens to the original manager. Existing
   allowance must first be inspected. Never grant unlimited token approval,
   an NFT operator approval or any permission over USDt0 or the old position.
5. Initialize the pair if required, then simulate a mint with at most 10 tokens
   of each acceptance asset, ticks -600 to 600 (fee 3000, spacing 60), both
   recipient and payer equal to the original wallet, fresh nonzero minimums and
   an explicit short deadline. Reject price movement, unexpected token usage
   or a changed pool. Confirm the exact simulated request and fee ceiling.
6. Obtain the actual NFT ID from the verified mint receipt and owner query;
   do not assume 66666 or any next token number. Revoke any leftover setup
   allowances after confirming amounts and fees.
7. Publish the reviewed executable candidate and verify complete bytes at the
   actual origins. Only then approve the acceptance token identities and
   perform the small exit using the existing direct-owner workflow. Preserve
   production gates until that separately reviewed change is complete.
8. Check the real receipt, collection events, token balances and remaining
   liquidity. Perform the original-origin failure and clean-device recovery
   tasks with the reviewed version. Record extension/version and origin
   observations separately from chain evidence.

Liquidity setup may require two deployments, two bounded approvals, pool
initialization and NFT mint, plus allowance cleanup. No live quote or total cost
is claimed here. Do not use the local fixture's zero mint minimums on mainnet.
The local fixture is an isolated test and does not exercise the extension.

## Local Verification

`tests/acceptance-assets.integration.test.ts` deploys these exact acceptance
artifacts, the official V3 factory and official position manager on isolated
Anvil. It compares full runtimes including metadata, fixed supply and bounded
allowances, then executes a 1% decrease-and-collect and verifies actual balances
and remaining liquidity with the existing recovery checker. No mainnet write,
real extension acceptance or independent review is claimed by those tests.

This route removes the WOKB source dependency from the protocol acceptance
pair. Independent review and actual wallet task evidence remain necessary.
