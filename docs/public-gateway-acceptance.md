# Published Gateway Acceptance

The public release `0.2.0-0d9ff56` passed acceptance on 2026-10-29 at
23:33 UTC (2026-10-30 at 07:33 in Asia/Shanghai).

- Application source: `0d9ff56a32b2ce36cd78c925d03f7205c169bf4a`.
- Manifest SHA-256: `c3c4101ae075a2dd1679213776dfc2d988494cb5c407ee58f82dc490b9a455cc`.
- Verifier source: `93b1760f931970e2d7c608f4689921542fab197b`.
- Successful run: <https://github.com/wangyangmingsss/tapeexit/actions/runs/40973429129>.
- Evidence artifact: `live-gateway-verification`.

Fresh desktop (1440 x 1000) and mobile (390 x 844) Chromium contexts verified
both `https://2-2-289.netlify.app` and `https://2-2-289.vercel.app`.
Each context checked all 10 release files, totaling 600302 bytes, against the
pinned manifest: 40 file checks overall. Same-origin Service Worker, Tape
identity, store configuration, paid activation and usable read-only layout
checks passed. All four views reported no JavaScript page errors.

During Vercel testing an HTTPS CONNECT proxy rejected connections to the
Netlify primary hostname. Each fresh desktop/mobile context demonstrated a
failed primary probe and then completed recovery through Vercel. This tests
manual use of the backup entry while the primary origin is unavailable.

Every view completed and exported a finalized read-only check of the existing
transaction
`0xef76ac4089198488982fa71d65c35e390884b950dfa0cfbcb8ca3c66efde27c5`
for position `67042`: USDt0 receipt `20016` base units, USDC receipt `19999`
base units (both have six decimals), remaining liquidity `1980854`.
No wallet was connected and no new transaction was sent.

Existing public bootstrap JavaScript matched the gateway build. The updated
application was loaded from the same chain container, so no additional hosting
deployment or publication signatures were required.

The first run, `40973023757`, failed because the browser defaulted to English
while the recovery helper selected Chinese controls. The helper now selects
Chinese explicitly. This was a verifier correction; the uploaded application
bytes were unchanged.

## Repeat The Check

Run `Verify public TapeExit gateways` with `release=published`, or:

```sh
npm ci
npm run build:gateway
npx playwright install --with-deps chromium
npm run verify:live-gateway -- docs/published-gateway-profile.json docs/gateway-recovery-task-67042.json
```

`published` checks the fixed uploaded release. `candidate` builds a future
release from the selected branch; it is not the correct acceptance mode for the
existing publication. `historical` checks the older release only.

## Remaining Gate

Independent security review is `NOT_COMPLETED`. Production signing remains
disabled (`RELEASE_APPROVED = false`) and the execution asset allowlist remains
empty. Browser recovery evidence does not constitute independent security
review, wallet-extension signing acceptance, physical-device testing, proof of
independent gateway backends, or a guarantee of future availability.
