# Independent Review Packet

Status: prepared for review; no independent reviewer or approval is claimed.

Review the exact Git commit, lockfile, manifest digest and build evidence together. Record reviewer identity, date, scope, findings, severity, remediation, retest and any remaining exclusions. Do not approve a moving branch.

| Surface | Entry Points | Required Review |
| --- | --- | --- |
| Deployment and assets | `src/config.ts`, `core/protocol.ts`, `tools/operations-core.ts` | Source/bytecode identity, upgrade governance, manager/factory, standard asset behavior and precision |
| Integer math and encoding | `core/protocol.ts` | Official SDK calculation, range/rounding, minimums, deadline, direct ownership, zero value, fixed recipient, decoded call equivalence |
| Wallet boundary | `core/wallet.ts`, `App.tsx` | EIP-6963 spoofing, stale accounts/chains/controllers, plan generation, rejection/unknown outcomes and malicious provider data |
| Evidence and finality | `core/receipt.ts`, `core/history.ts`, `core/rpc.ts` | Input and token/pool events, canonical block, stale/future/requested heights, safe/finalized and availability limits |
| Submission lock | `core/submission.ts`, `App.tsx` | Before-send durability, Web Locks, hash recovery, refresh, storage failure, clearing history and cross-origin/device limitations |
| Publication | `tools/publish-core.ts`, `resume-publication-core.ts`, `verify-publication-core.ts` | Exact manifest, chunk metadata and bytes, prefix verification, stale/concurrent updates, implementation pins and ownership |
| Entrypoint/recovery | `core/runtime.ts`, `local-server.mjs`, `gateway.mjs`, pinned TapeKit | Controller identity, reserved paths, filesystem boundaries, headers, bootstrap trust and original source isolation |
| Build dependencies | lockfile, audit/context, module graph and scope report | Each direct advisory, propagation, install/build execution and actually emitted browser code |

## Known Open Questions

- No independent validation of RPC operators' common upstreams or full L2 consensus.
- Same-origin journal cannot coordinate different gateways/devices or cleared storage. Unknown transactions have no automatic unlock.
- Standard-asset approval requires behavior and governance review; metadata/code hashes alone are insufficient.
- Publication preflight observes implementation code hashes but does not independently approve them or prove processor sealing.
- Prefix resume does not lock a mutable container. Every later state and wallet request needs revalidation.
- Asset observations now follow standard implementation/beacon pointers, sample beacon returns with two callers,
  and record admin addresses/code at the fixed block. `verify:assets` compares a digest-bound baseline and
  rejects changed code, pointers, admins or metadata. Neither standard slots nor two caller samples prove
  actual delegatecall paths, all caller behavior, governance or standard token semantics.
- The injected-wallet harness and browser fixtures do not prove the actual TapeOut/OKX Wallet combination.
- Remaining npm findings are not dismissed by tree-shaking or use of an injected signer.

## Evidence Commands

Run `npm ci --ignore-scripts`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:release`,
`npm run report:dependencies`, `npm run report:dependency-scope`, `npm run verify:reproducibility`
and the browser suite in a permitted environment. Preserve failing evidence as well as successful reports.

The three explicit transitive overrides fix tmp, diff and serialize-javascript versions while keeping the official V3 SDK. Compatibility probes cover solc temporary files, Mocha patch operations and serialization, plus the full V3 suite. They do not constitute an independent audit of those dependencies.

## Sign-Off Template

```
reviewer:
reviewedAt:
sourceCommit:
manifestSha256:
scope:
findings:
remediationAndRetest:
remainingExclusions:
decision:
evidenceDigest:
```

Leave this blank until a real reviewer provides the evidence. Internal engineering checks must not be labelled independent review.
