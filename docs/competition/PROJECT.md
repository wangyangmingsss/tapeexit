# TapeExit Project Draft

Status: local development candidate. This document is ready to review, not a completed competition submission. Real TapeOut deployment, target-wallet acceptance and independent security review are still pending.

## Short Description

TapeExit is an independent exit interface for directly owned Uniswap V3 position NFTs on X Layer. If the original website or private API is unavailable while the protocol remains operational, the holder can read a known position, review a decrease-and-collect or collect-only call, and use their own wallet to interact with the original manager.

The application introduces no custody contract, new token approval, NFT transfer, swap, agent signing or arbitrary recipient.

## Why TapeOut

The intended deployed product stores the application files in a real X Layer TapeOut container, uses client verification to load them, and pairs that entry with an alternate gateway and a separately verified local recovery package.

Today the fixed TapeKit build, upload encoder, actual path-resolver compatibility and publication readback tool are implemented. A TapeExit container has not been published. Do not describe those tests as a live TapeOut deployment.

## What Can Be Demonstrated Today

- A clearly labelled isolated UI simulation with test assets.
- Read-only checks against the configured X Layer manager and factory; evidence files record the observed block and code hashes.
- An isolated fork of an actual X Layer position, with recorded exit, balance changes and remaining liquidity.
- Real official V3 contracts on a local EVM: partial and full exits, collect-only with and without remaining liquidity, ownership rejection, slippage/deadline revert and atomic collection-failure rollback.
- Strict two-operator reads, exact SDK integer math, calldata checks, receipt evidence, durable pending-submission recovery and entry invalidation.
- A local recovery server, hashed file manifest and offline file verification.

No mainnet transaction was broadcast. Production signing is disabled and the approved asset list is empty.
The prior candidate's 16 browser tests passed remotely. The expanded 21-test suite and new tools need their exact commit's results.
Read-only asset/container inspection, unsigned prefix resume, a wallet connectivity harness, bounded owner-checked position discovery,
printable public recovery cards, simulation recording and consented-session aggregation are implemented.

## Scope And Limits

Supports one configured protocol and chain, a manually entered or owner-enumerated token ID, direct ownership and reviewed standard tokens. Staked/vault-held NFTs, unknown forks, contract-wallet support, fee-on-transfer/rebase assets and lost keys are outside the accepted scope.

The browser, wallet, bootstrap files, RPC operators, X Layer and protocol/token contracts remain trusted dependencies. Matching file hashes is not a security audit. Local code still needs network RPC and an operational chain.

## Differentiation To Test

The hypothesis is that a saved, task-specific exit route with explicit dependency and recovery evidence is easier to use during a frontend outage than reconstructing the original application or composing raw explorer calls.

This has not been established by a controlled comparison or user study. There are no claimed users, customers, revenue, endorsements or partnerships.

## Business Hypothesis

The base exit tool is open source and free. Protocol-funded adapter review, deployment, periodic fault rehearsals and maintenance are potential services, subject to user research and actual customer evidence. No emergency-exit fee is implemented.

## Required Before Submission

1. Verify the current official activity rules and actual submission form; do not infer current eligibility or deadline from this draft.
2. Keep the public `wangyangmingsss/tapeexit` repository updated and record the final public commit.
3. Complete target-wallet/browser tests, supported-asset review and independent transaction-path review.
4. Obtain a real circuit/container, approved publisher wallet, explicit maximum OKB budget and hosting access.
5. Publish, read back exact files, verify live status, load the actual origin and rehearse alternate/local entry.
6. Collect permissioned user-task and protocol feedback, or plainly disclose that validation is pending.
7. Record the accurately labelled video and review all final links and claims before submitting.
