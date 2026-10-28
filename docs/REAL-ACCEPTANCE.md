# Real Release Acceptance

This runbook covers requested items 2, 3, 4 and 5. Tool implementation, local fixtures and unsigned plans are not completion evidence. Production signing remains disabled until the reviewed release process is replaced deliberately.

## Inputs Before Actual Publication

Provide the controlled publisher's public address, an owned circuit ID and its processor index, and the actual container if already opened. If there is no circuit/container, explicitly choose an existing processor and authorize obtaining the required circuit/container after reviewing the concrete operation and cost. A separate processor deployment is not inherently required.

Provide separate bounded amounts for upload, activation and any circuit acquisition, together with the native currency and time horizon. A budget is authorization, not an observed cost. Do not provide a private key, seed phrase, wallet password or session token.

Provide two actual HTTPS gateway origins, operator names and hosting access through an existing authenticated deployment client. Record DNS/CDN/cloud/RPC sharing rather than asserting independence from different hostnames.

## 2. Publish And Read Back

1. Run `npm run inspect:tapeout` to observe the pinned public registry interfaces. This does not choose or approve a processor.
2. Fill `docs/publication-profile.example.json` with the real identity and reviewed runtime digests. Never copy observed hashes into an approved profile without review.
3. From a clean commit, build and independently save the manifest SHA-256. Run `inspect:publication` and `rehearse:publication` against that profile. Inspect every unsigned call and the budget.
4. Use the controlled publishing wallet for the exact reviewed sequence. A specific operation and its fee must be reviewed before a real payment; unknown submission stops the sequence.
5. Run `verify:publication` against the independently saved digest, verify live activation separately, and retain transactions, actual gas and activation cost. Rerun the readback after any mutation.

The plan and local rehearsal do not broadcast. There is no automatic retry or generic arbitrary-call executor in this workflow.

## 3. Actual Origin And Target Extension

Use an actual supported browser with the target OKX Wallet extension and a controlled position. Record extension/browser versions, exact origin, source commit, manifest digest, container and date. The local connectivity harness can prepare the browser, but does not meet this acceptance.

Before authorizing an asset task, check controller identity, status and page client verification, release file bytes and chain. Verify discovery with multiple extensions, explicit wallet selection, user rejection, changed account, changed chain, disconnect, reload with a pending transaction, unknown send outcome and controller replacement. Confirm that invalidated previews require a new read and review.

Review the actual wallet request: expected chain, manager, owned NFT, fixed account recipient, zero native value, only decrease/collect and no new approval. After a separately authorized funds task, compare mined input, pool/token events, remaining position, safe/finalized state and durable journal behavior. Cancellation/replacement must be verified in the extension and chain; do not clear unknown state to repeat a send.

Save browser traces/screenshots and wallet observations locally with consent; redact unrelated activity before sharing. A CLI wallet, synthetic provider or a human-entered checkbox does not prove extension behavior.

## 4. Assets And Independent Review

Supply the exact candidate asset contracts, intended task and position. Record issuer identity, decimals, runtime/source correspondence, implementation/beacon/admin dependencies, governance and possible upgrades, pause/blacklist, transfer taxes, rebase and bridge assumptions.

Use `inspect:assets` and `verify:assets` for identity observations, then test actual candidate behavior in an isolated fixed-block fork. Confirm normal pool-to-owner transfer, exact balance changes, supported precision, remaining liquidity and atomic rollback on failed collection. A favorable metadata or proxy report does not approve an asset.

An independent reviewer must review the exact source and release digest using `SECURITY-REVIEW-PACKET.md`, with scope, findings, severity, remediation, retest and exclusions. Internal tests and this runbook do not supply independence. Keep all nine low dependency findings open until their actual call paths and release decisions are reviewed.

## 5. Public And Local Recovery

After real publication and gateway deployment, fill `docs/release-profile.example.json` and run `verify:gateways` from a permitted Chromium environment. It checks file bytes and identity using fresh browser contexts, and blocks primary HTTPS CONNECT requests during alternate recovery.

Complete three distinct actual tasks: block the protocol's original frontend and private API; block the primary TapeOut gateway; make online application hosting unavailable and start an independently verified recovery package on a clean device. For each, record the effective block, failed requests, allowed RPC endpoints, exact release, wallet request and task outcome. A read-only load is labeled read-only.

Before switching origins, inspect the original wallet transaction and pending journal. Journals do not coordinate across origins/devices; do not resend because the new origin has no local record. The local package still needs wallet, chain and RPC; it is not an offline transaction tool.

## Evidence And Hand-Off

Keep raw artifacts with digests. Fill real evidence only after observing the event; leave missing names, addresses, fees, reviewer decisions and task results unset. The formal preflight checks consistency and freshness but cannot authenticate human claims.

The requested commercial work is tracked by `competition/PILOT-PLAN.md` and `model:business`. Outreach text is a draft; a named recipient and explicit permission are required before contacting someone. No pilot or revenue is claimed.
