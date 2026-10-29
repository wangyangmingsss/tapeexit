# Controlled Recovery Handoff

The development workflow is implemented. An independent review and an actual extension signature are
external evidence, not outputs a developer can manufacture. The production gate and token list remain closed.
Keep publication receipts separate from exit receipts.

## Current Route

The latest user-directed real-asset test uses USDt0/native USDC V3 #67042.
See `CONTROLLED-TEST-67042.md` for its explicitly separate, unreviewed,
one-position small-test tool and consent. It leaves general production signing
disabled and does not claim to meet this document's reviewed-release acceptance.
The fixed-supply route below remains an optional local protocol demonstration.

The WOKB source investigation has been discontinued as an acceptance blocker.
Use `ACCEPTANCE-ASSETS.md`: two fixed-supply assets with fully embedded source
replace the original USDt0/WOKB acceptance pair. WOKB positions remain readable
but new plans and release asset policies exclude them. Its address is retained
only for original-manager identity verification. The old position and all
historical evidence are preserved. The sections below describe the original
investigation; their WOKB proposal is historical, not the current task.
Independent review and reviewed executable-release wallet tasks are still open.

## 1. Asset Evidence

`ASSET-REVIEW-66666.md` records the prior USDt0 source observations, issuer/proxy risks and seven isolated
fork cases. `verify:runtime-source` compiles embedded standard JSON with the exact installed solc version,
pins its caller-trusted input digest, compares complete deployed runtime including metadata through two
RPC labels at a fixed block, and rechecks the block hash. It refuses external imports, empty code and
unresolved libraries. It does not strip metadata, substitute immutables or infer provenance from a match.

```sh
npm run verify:runtime-source -- input.json TRUSTED_SHA256 EXACT_INSTALLED_SOLC_VERSION source.sol:Contract ADDRESS DECIMAL_BLOCK
```

The repository currently pins solc 0.7.6 for local protocol fixtures. This does not establish WOKB's compiler.
Do not change compiler settings or install an unverified remote compiler just to obtain a match.
WOKB source/runtime correspondence is still unresolved; the latest Sourcify response had `match: null`.
`npm run inspect:runtime-metadata -- ADDRESS DECIMAL_BLOCK` now preserves the complete runtime, code hash,
fixed block and any recognized legacy Solidity bzzr0 metadata pointer through the existing two-RPC
quorum. It never strips metadata or infers a compiler from that pointer. The WOKB pointer is
`1acd4c242aa9e7d3204e3739c65c4f1f467447774834e66773b0ac0e7b3dfe9e`.
The queried Swarm gateways did not return its metadata. A WETH-like interface or official token-list
address cannot establish exact source correspondence. A source/compiler/settings record from the
deployer or explorer is still needed before the complete runtime verifier can resolve this blocker.
The official `okx/xlayer-docs` token table lists the WOKB address, which is identity documentation, not a source audit.
USDt0 owner/admin powers include blocking, destruction of blocked funds and upgrades; a current unblocked
observation cannot establish future transfer safety or governance thresholds.

## 2. Read-Only Rehearsal Preparation

```sh
npm run prepare:recovery -- 66666 0x101fd328a0b2fd9e853909651dab1c0b55947c03
```

This verifies the deployment, direct owner and actual position at a pinned block, gathers token/proxy
identities, reads current USDt0 blocking for owner/pool/manager and proposes 1% liquidity with the existing
SDK's 50-bps principal minimum calculation. The output is
`release-artifacts/controlled-recovery-preparation.json`.

The proposal is not a simulated transaction, fiat cap or authorization. Fees are not included in the
principal estimate. Gas quote, calldata and fee authorization remain null. No wallet is contacted.
The report records all blockers even when a separate release gate has been enabled.

Before a real task, obtain review of the exact source/manifest/dependencies and asset controls, publish
and read back that reviewed candidate, confirm extension behavior at its actual origin, and obtain the
user's explicit removed-liquidity, minimum-output, recipient, gas ceiling and expiry approval.
Read and simulate again just before the wallet request. Do not reuse this proposal as signed calldata.
Use `prepare:review` and the signed intake described in `SECURITY-REVIEW-PACKET.md` to freeze this handoff.
There is no alternate hidden signer, temporary token allowlist or development bypass for a real exit.

## 3. Transaction Acceptance

The existing UI owns the signing flow and durable unknown-outcome lock. Following a receipt,
**Check balances and liquidity** adds historical state corroboration; the operation export includes it.
The command-line checker is available after reload or a gateway switch:

```sh
npm run verify:recovery -- 66666 ACTUAL_EXIT_HASH 0x101fd328a0b2fd9e853909651dab1c0b55947c03
```

This checks original manager, zero value, direct collect or decrease-and-collect calldata, token ID,
sender, pool collection events, token transfers, canonical receipt and transaction identity. It compares
parent/receipt block-end token balances and position state, checks exact expected remaining liquidity
and cleared owed amounts, then rechecks the transaction/receipt after the historical reads.
It writes `release-artifacts/recovery-outcome.json`. Exit status is zero only for matched state and
finalized receipt. Pending, reverted, mismatched, unavailable archive state and reorgs cannot pass.

Block-end comparisons cannot isolate other same-block activity. A discrepancy requires investigation,
not an automatic resend. Even matching state is corroboration, not proof of sole transaction attribution.
The checker never deletes the browser submission lock or asks for a signature.
Formal release preflight now requires the actual exit hint and re-runs this inspection live instead of
trusting a saved success file. It first validates original signed review artifacts and the separately
confirmed reviewer key digest, then requires finality and asset-policy correspondence. See
`RELEASE-PREFLIGHT.md`. Chain evidence cannot establish the actual signing frontend or extension;
browser and wallet acceptance observations remain necessary.

## 4. Fault Tasks And Evidence

Preserve original pending state before switching origins; locks do not coordinate across origins/devices.
Use the existing HTTPS CONNECT proxy and gateway verifier for a real primary-origin block.
Record the exact candidate source/manifest, effective block log, loaded file hashes, browser/extension
versions and task outcome. A read-only task must retain that label. Complete a separate clean-device
local package task with application hosting blocked but necessary chain RPC available.

The historical `733ca79` release already has dated desktop/mobile dual-gateway read-only evidence.
`report:readiness` and `package:entry` validate its saved digests and preserve its source separately.
They do not call it current deployment, wallet acceptance, review approval or a mainnet exit.
Rules/form verification, entrant/contact information and a real submission receipt remain external inputs.
