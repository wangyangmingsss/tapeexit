# TapeExit Acceptance And Handoff

This candidate is not a production release. `RELEASE_APPROVED=false` and the approved token list remains empty.

## Locally Reproducible Work

```sh
npm ci
npm run typecheck
npm test
npm run vendor:tapekit
npm run test:tapekit
npm run build
npm run check:release
npm run report:dependencies
npm run report:dependency-scope
npm run verify:reproducibility
npm run build:demo
npm run build:gateway
```

The reproducibility command requires a clean committed checkout. Its fresh clone installs with lifecycle scripts disabled; it compares two builds on the same machine/toolchain and the local release. It does not test another device.

The official local V3 suite isolates tests using EVM snapshots. It checks actual balance changes, receipt events and liquidity state for partial/full exit and collect-only, as well as ownership failure, minimum-output failure, expired deadline and collection-failure rollback. Its two RPC labels target the same isolated local EVM and are not proof of independent mainnet operators.

Use the separately documented deployment/fork commands for network evidence. Keep the block, hash, exact configuration and environment labels; do not mix fork and mainnet transaction claims.

## Browser Matrix

After building production and installing the matching Chromium:

```sh
npx playwright install chromium
npm run test:e2e
```

The configuration starts the demo at port 4174 and the actual production recovery server at 4175. Test both 360, 390, 768, 1280 and 1440 px. Preserve screenshots, traces and failures. DOM tests and a successful `--list` are not browser-pass evidence.

The 16 prepared cases cover the simulated task, disagreement, recovery import, review/focus and production read-only/pending recovery. They do not exercise a real wallet or actual TapeOut Service Worker. The current machine cannot launch Chromium because macOS rejects MachPortRendezvous bootstrap; changing the test assertions cannot resolve that external restriction.

## Remaining Gates

| Gate | Status | Required Input Or Evidence |
| --- | --- | --- |
| Correct GitHub publication | Blocked | Supported authentication for the user's intended account; `/user` must match before creating/pushing a repository |
| Browser and layouts | Blocked locally | Environment that can launch Chromium, screenshots and complete 16-case result |
| Actual TapeOut origin and target wallet | Not accepted | Real origin, target extension, wallet request/response trace, controller changes, cancellation, account/chain changes and refresh |
| Supported assets | Not approved | Exact token contracts and nonstandard-behavior review; do not simply change the allowlist |
| Independent transaction/security review | Not completed | Independent reviewer, reviewed commit, findings and retest |
| Dependency remediation | Findings open | Advisory/call-path review and compatible fixes or documented release decision |
| Actual container publication | Not executed | Circuit/processor/container, publishing wallet and approved maximum OKB budget |
| Exact live file readback | Not executed | Real container, independent saved manifest digest, two-source byte comparison and live status |
| Alternate gateway and local recovery rehearsal | Not accepted | Actual hosting/origins, same-version task, faults proven effective, request logs |
| Permissioned mainnet task | Not executed | Reviewed release, approved assets, controlled position, exact transaction and fee authorization |
| User/comparison/protocol validation | Not performed | Consented participants, same-task records and permissioned attribution |
| Competition submission | Not submitted | Current official rules/form, team/contact details, real links, reviewed video and actual submission receipt |

## Safe Continuation

Credentials belong in supported client authentication, not source, a script or a report. Verify only the account login before repository writes. The configured account last checked is explicitly not the user's target account; no remote has been created.

External funds and publication are separate from development permission. Do not create a circuit, activate a container, upload paid files or submit a mainnet exit without concrete wallet/container and bounded-fee inputs.

Keep the production gate closed while the required acceptance remains incomplete. A local test count, a file digest or the module-graph report cannot waive these gates.
