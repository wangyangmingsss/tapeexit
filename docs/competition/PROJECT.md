# TapeExit Project Draft

Status: development candidate with a separately recorded, published read-only release. This is a draft, not a completed competition submission. Actual extension signing, a mainnet exit and independent security approval remain pending.

## Short Description

TapeExit is an independent exit interface for directly owned Uniswap V3 position NFTs on X Layer. If the original website or private API is unavailable while the protocol remains operational, the holder can read a known position, review a decrease-and-collect or collect-only call, and use their own wallet to interact with the original manager.

The application introduces no custody contract, new token approval, NFT transfer, swap, agent signing or arbitrary recipient.

## Why TapeOut

The published read-only release stores the application files in a real X Layer TapeOut container and uses client verification to load them. The recovery design also provides an alternate gateway and a separately verified local package.

The recorded publication is `tape://2.2.289.tape/`, container
`0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D`, source
`733ca795d9216ea43038e386ee652c1a84f112b5`, manifest SHA-256
`8282142e417188b95421249ec7beb8993aaea65308c7e87b337c08a9c77415ba`.
Nine files / 587,736 bytes were uploaded in 31 operations across 23 transactions.
The recorded gateways are `https://2-2-289.netlify.app` and `https://2-2-289.vercel.app`.
The October 28 UTC browser report checks desktop/mobile resources and exercises a CONNECT-proxy block of the primary gateway.
See `evidence/historical/` for immutable observations, dates and limitations. These are read-only recovery observations,
not a live exit or evidence that the current source has been uploaded. Availability and payment expiry require fresh checks.

## What Can Be Demonstrated Today

- A clearly labelled isolated UI simulation with test assets.
- Read-only checks against the configured X Layer manager and factory; evidence files record the observed block and code hashes.
- An isolated fork of an actual X Layer position, with recorded exit, balance changes and remaining liquidity.
- Real official V3 contracts on a local EVM: partial and full exits, collect-only with and without remaining liquidity, ownership rejection, slippage/deadline revert and atomic collection-failure rollback.
- Strict two-operator reads, exact SDK integer math, calldata checks, receipt evidence, durable pending-submission recovery and entry invalidation.
- A local recovery server, hashed file manifest and offline file verification.

Real mainnet publication/activation transactions exist. No TapeExit mainnet exit is recorded.
Production exit signing is disabled and the approved asset list is empty.
Use the packaged exact-source test reports for current counts; historical CI counts do not validate new changes.
Read-only asset/container inspection, unsigned prefix resume, a wallet connectivity harness, bounded owner-checked position discovery,
printable public recovery cards, simulation recording and consented-session aggregation are implemented.
The recovery outcome checker corroborates exact transaction/receipt identity with parent/receipt block-end
balances, remaining liquidity and cleared owed amounts. It labels block-level attribution limits.
`prepare:recovery` gathers a read-only one-percent proposal and blockers; it creates no signing calldata.

## Scope And Limits

Supports one configured protocol and chain, a manually entered or owner-enumerated token ID, direct ownership and reviewed standard tokens. Staked/vault-held NFTs, unknown forks, contract-wallet support, fee-on-transfer/rebase assets and lost keys are outside the accepted scope.

The browser, wallet, bootstrap files, RPC operators, X Layer and protocol/token contracts remain trusted dependencies. Matching file hashes is not a security audit. Local code still needs network RPC and an operational chain.

## Differentiation To Test

The hypothesis is that a saved, task-specific exit route with explicit dependency and recovery evidence is easier to use during a frontend outage than reconstructing the original application or composing raw explorer calls.

This has not been established by a controlled comparison or user study. There are no claimed users, customers, revenue, endorsements or partnerships.

## Business Hypothesis

The base exit tool is open source and free. Protocol-funded adapter review, deployment, periodic fault rehearsals and maintenance are potential services, subject to user research and actual customer evidence. No emergency-exit fee is implemented.

`PILOT-PLAN.md` specifies consented incident research, a bounded protocol pilot, matched outage-task comparison
and stop conditions. `BUSINESS-ASSUMPTIONS.example.json` deliberately leaves numeric assumptions unset.
`npm run model:business` computes explicit-assumption costs and break-even; it is not customer or revenue evidence.
`REAL-ACCEPTANCE.md` in the preparation archive lists the real publication, wallet, review and hosting inputs.

## Required Before Submission

1. Verify the current official activity rules and actual submission form; do not infer current eligibility or deadline from this draft.
2. Keep the public `wangyangmingsss/tapeexit` repository updated and record the final public commit.
3. Complete target-wallet/browser tests, supported-asset review and independent transaction-path review.
4. Keep the existing container/history intact; obtain review and a bounded fee authorization before publishing a newer release.
5. Read back that candidate's exact files, check live status and actual origin, and complete extension/local-device recovery tasks.
6. Collect permissioned user-task and protocol feedback, or plainly disclose that validation is pending.
7. Record the accurately labelled video and review all final links and claims before submitting.
