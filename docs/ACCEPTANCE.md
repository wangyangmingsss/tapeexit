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

The production wallet selection regression cases cover competing pending connections, closing the
picker before a response, and malformed account responses. Providers are explicit injected fixtures.
The unit/DOM cases additionally cover immediate application-side abort cleanup, stale errors,
unmount, account/chain changes during authorization, strict response validation, and bounded
discovery. Cancelling in TapeExit discards the application request; it cannot dismiss an extension's
own permission window. This does not replace actual target-wallet acceptance.

After building production and installing the matching Chromium:

```sh
npx playwright install chromium
npm run test:e2e
```

The configuration starts the demo at port 4174, production recovery at 4175, a second local copy at 4176 and the wallet connectivity harness at 4180. Test 360, 390, 768, 1280 and 1440 px. Preserve screenshots, traces and failures. DOM tests and a successful `--list` are not browser-pass evidence.

The previous 16 cases passed on commit `7219c8a` in GitHub Actions run `40516216450`. The expanded 20-case suite adds a controlled loopback network outage and fixture-provider harness checks. It does not exercise a real wallet or actual TapeOut Service Worker. The current machine cannot launch Chromium because macOS rejects MachPortRendezvous bootstrap; verify each new commit through its actual remote result.

## Remaining Gates

| Gate | Status | Required Input Or Evidence |
| --- | --- | --- |
| Correct GitHub publication | Completed for prior candidate | Public `wangyangmingsss/tapeexit`; verify each new pushed commit matches local |
| Browser and layouts | Prior 16 cases passed remotely; expanded suite needs current result | Match screenshots and test output to the exact commit |
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

Credentials belong in supported client authentication, not source, a script or a report. Verify account login before repository writes. The user's intended account is `wangyangmingsss`; the public repository exists and prior candidate history has been pushed.

External funds and publication are separate from development permission. Do not create a circuit, activate a container, upload paid files or submit a mainnet exit without concrete wallet/container and bounded-fee inputs.

Keep the production gate closed while the required acceptance remains incomplete. A local test count, a file digest or the module-graph report cannot waive these gates.

Read `OPERATIONS.md` for read-only publication/asset probes, safe unsigned resume, wallet connectivity collection,
recording and draft packaging. `SECURITY-REVIEW-PACKET.md` provides a reviewer handoff, not a review result.

## RPC 传输边界回归

`tests/rpc-transport.test.ts` 覆盖响应版本/请求 ID、互斥结果与错误、结构化错误、非法 JSON/UTF-8、4 MiB 响应上限及中止读取；真实 loopback HTTP 测试核对重定向未访问目的地址、收到响应头后超时仍中断响应体。规范 uint256 quantity、单来源 gas 畸形值、零估算与合法零价格另有边界测试。

生产浏览器恢复测试注入两个一致但协议无效的 RPC 响应：错误 ID、缺版本、result/error 共存；预期停止在链读取、保留原待处理记录和发送锁。均为明确 RPC 夹具，不代表真实主网故障或真钱包验收。
