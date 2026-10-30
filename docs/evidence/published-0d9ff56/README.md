# Published Read-Only Release Evidence

Application source: `0d9ff56a32b2ce36cd78c925d03f7205c169bf4a`.
Manifest SHA-256: `c3c4101ae075a2dd1679213776dfc2d988494cb5c407ee58f82dc490b9a455cc`.
These reports preserve observations made on 2026-10-29 UTC, not a guarantee of
future availability, activation or chain state.

| File | Evidence |
| --- | --- |
| `profile.json` | Fixed source, manifest, container and two gateway origins |
| `publication-verification.json` | Exact 10-file / 600302-byte chain readback and live container at the recorded block |
| `migration-stage.json` | 31 confirmed migration attempts, no unresolved request, zero remaining operations |
| `public-acceptance.json` | Summary of the published-version public acceptance |
| `verification.json` | Four fresh desktop/mobile views, 40 exact file checks and effective primary HTTPS CONNECT blocking |
| `*-recovery.json` | Finalized read-only recovery exports from all four public browser contexts |
| `development-44aeb18.json` | Later review-tool source: 953 local tests, separate from the published application |
| `dependency-audit.json` | Registry scan with 11 low findings; not an independent safety conclusion |
| `review-packet.json` / `review-template.json` | Frozen review identity and deliberately incomplete external-review template |
| `evidence-index.json` | File digests for these selected reports |

The saved exit is position `67042`, transaction
`0xef76ac4089198488982fa71d65c35e390884b950dfa0cfbcb8ca3c66efde27c5`.
Receipt and block-state evidence match 0.020016 USDt0, 0.019999 USDC and
remaining liquidity `1980854`. This was a separately bounded local-workbench
transaction. Public gateway acceptance rechecks its existing result without
connecting a wallet or sending another transaction.

The public browser workflow passed:
<https://github.com/wangyangmingsss/tapeexit/actions/runs/40973429129>.
Its `live-gateway-verification` artifact contains the original screenshots.

Source, recovery, gateway packages, screenshots, review-preparation materials
and checksums are attached to the
[read-only prerelease](https://github.com/wangyangmingsss/tapeexit/releases/tag/v0.2.0-readonly-0d9ff56).
The release tag identifies the uploaded application, not the newer development
branch or review-tool source.

Production signing remains disabled and the execution asset allowlist is empty.
Independent review, full actual-extension acceptance, clean-device recovery,
user research and formal competition submission remain incomplete.
Publisher journals, authorization state, credentials and private keys are not
included in this public evidence set.
