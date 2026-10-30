# Published Read-Only Release Evidence

Application: `0.3.0-2597f66`.
Source: `2597f667dd0fcaefc416dd66e9cf513d75ef78d4`.
Manifest SHA-256: `3108213d676a2f4cbee87943d8be031e1dcf880077f4c847618568e85b9c190a`.
TapeOut name: `2.2.289.tape`.
Container: `0x5A8aE6857FD40df5c7dCa7F378e4Cc74Ff58e59D`.

The 33 additional wallet confirmations completed the 34-transaction incremental
update. All 34 are confirmed, with zero remaining operations or unresolved
requests. The verifier left the original publisher journal unchanged and sent
no transaction.

| File | Evidence |
| --- | --- |
| [profile.json](profile.json) | Fixed source, manifest, container and two gateway origins |
| [publication.json](publication.json) | Exact 12-file / 620917-byte chain readback; live container at the recorded block |
| [release-manifest.json](release-manifest.json) | Uploaded release file identities |
| [public-acceptance.json](public-acceptance.json) | Acceptance summary and explicit scope |
| [gateways.json](gateways.json) | Four fresh desktop/mobile views, 48 exact file checks and primary HTTPS blocking |
| `*-recovery.json` | Finalized read-only recovery exports from all four browser contexts |
| [SHA256SUMS.txt](SHA256SUMS.txt) | SHA-256 digests of the selected JSON evidence files |

Public acceptance completed at 2026-10-30 11:14 UTC:
<https://github.com/wangyangmingsss/tapeexit/actions/runs/41045994985>.
The `live-gateway-verification` artifact contains the original reports and
screenshots. The verifier ran at the exact uploaded source commit.

All four views checked the existing position `67042` transaction
`0xef76ac4089198488982fa71d65c35e390884b950dfa0cfbcb8ca3c66efde27c5`,
matching 0.020016 USDt0, 0.019999 USDC and remaining liquidity `1980854`.
The Vercel checks succeeded while Netlify HTTPS connections were blocked.
No wallet was connected and no new exit transaction was sent during acceptance.

Production signing remains disabled. Independent security review and full
actual-extension wallet acceptance remain `NOT_COMPLETED`. These observations
do not guarantee future availability or chain state. Historical release
evidence is preserved separately in [published-0d9ff56](../published-0d9ff56/README.md).
