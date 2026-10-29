# Position 66666 Internal Review

Status: engineering evidence collected; no asset approval or independent TapeExit review.

## Reproduction

The user's directly held X Layer position uses the pinned Uniswap V3 manager,
USDt0/WOKB, fee 500 and full-range ticks -887270 to 887270. The baseline block is
74462430, hash `0x292df1b9c3ceb6d7ead9f9eada4c79221d93f99ae43ad9de9b5f59eccfdaceae`.

Run from a clean checkout:

```sh
npm ci
npm run typecheck
npm test
npm run verify:asset-fork -- 66666 --block=74462430
npx tsx tools/verify-usdt0-risk-fork.ts 66666 --block=74462430
```

The fork preserves the account's EIP-7702 delegation. Only empty-code accounts
or the exact delegation and implementation hash already pinned by the publication
tool are accepted for local impersonation. Unknown contract wallets fail closed.
The independent upstream baseline checks the same account identity before forking.
No code override or mainnet write is used. Impersonation does not exercise the
wallet's signature path or prove the delegate contract's security.

Six separately restored cases cover partial/full removal, collection with/without
remaining liquidity, minimum-output failure and expired-deadline failure. Successful
cases compare pool/token receipt evidence against exact wallet balance changes and
remaining liquidity. Failed cases require no logs, no token movement and no change
in liquidity or owed amounts. The minimum/deadline cases fail during decrease;
they do not establish rollback after a token transfer fails during collection.

The separate USDt0 risk fork impersonates the observed token owner only in the
disposable local EVM and adds the pool to the blocked list through the actual
token function. It first confirms that the plan's exact decrease call succeeds
in simulation. The application's combined preview rejects the blocked transfer;
a direct local call reports the V3 transfer failure `TF`. A deliberately sent
local multicall then reverts with no logs, no token balance changes and unchanged
liquidity/owed amounts. The token owner is funded only inside the fork. No claim
is made about real governance authorization or extension signing.

## Primary Sources

- Uniswap deployment documentation at commit
  `1c7597d73be0e9a3a4e44aa75b8fb212b40ea136`,
  `content/protocols/v3/deployments/v3-xlayer-deployments.mdx`.
  Its manager, factory and wrapped-native addresses match project configuration.
- Uniswap default token list at commit
  `68087f794ef8c8adeb376837b2651f9b4ac44fe7`, `src/tokens/xlayer.json`.
  It includes the supplied USDt0 address with six decimals. Listing is not approval.
- Sourcify v2, chain 196: USDt0 proxy and implementation both report exact runtime
  matches. The collected runtime bytes are also compared to two RPC sources at
  the asset baseline block. This does not independently rebuild the source.
- Everdawn-Labs/usdt0-audit-reports at commit
  `f6503756a07e8d6e65aabaeff2fd0a7373157e03`,
  `Guardian/USDT0_XLayer_Deployment_report.pdf`. Its September 27, 2025 report
  identifies the same token, implementation and proxy-admin addresses. It records
  one acknowledged informational finding about differing proxy/admin bytecode
  build settings. It is not an audit of TapeExit or a sign-off for this release.

Raw source records, source digests and the PDF are retained in the local review
delivery. Do not replace review decisions with an external report's confidence score.

## Asset Behavior And Governance

The retrieved USDt0 implementation inherits OpenZeppelin ERC20 balance accounting.
The reviewed transfer path has no explicit fee-on-transfer or rebase calculation.
The six fork cases only demonstrate the sampled state and paths.

The token owner can manage the blocked list, destroy blocked funds, mint, redeem,
change the OFT contract and change token metadata. A blocked sender's transfers
are restricted by the pre-transfer hook. The OFT contract can mint/burn through
the cross-chain extension. The proxy administrator can replace implementation code.
Owner/admin addresses and current blocked flags are observations, not proof of
their control policies, signer thresholds, timelocks or future behavior.

WOKB's mapping is confirmed by the Uniswap deployment documentation and its sampled
pool-to-wallet transfers pass the fork matrix. Its Sourcify lookup returned 404.
Empty EIP-1967 slots do not prove immutability or establish runtime/source identity.
Verified source or a reproducible runtime match remains required for review.

## Open Release Conditions

- Independently assess the token source, upgrade/admin and bridge controls.
- Establish WOKB runtime/source identity.
- Obtain an independent reviewer decision for the exact TapeExit commit, build
  manifest digest, dependencies, wallet boundary and collected evidence.
- Complete target-extension signing and controlled real exit only after approval.

`SUPPORTED_TOKENS` stays empty and `RELEASE_APPROVED` stays false. Existing TapeOut
publication and gateway verification remain evidence for the original read-only
release; they do not verify a newly enabled signing build.
