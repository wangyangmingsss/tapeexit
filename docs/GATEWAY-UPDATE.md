# Gateway Update And Read-Only Recovery Acceptance

Production signing stays disabled; independent review is not completed.
This update adds a public transaction recovery form to the existing application.
It takes a position ID, original public wallet address and existing transaction hash.
It reads receipts, token arrivals and adjacent block-end balances/liquidity from RPC,
requires finality for success, and can export its result without connecting a wallet.
Cancellation, timeout or input edits invalidate the current result.

The `0d9ff56` update is now published: 31 confirmed migration transactions,
zero remaining operations, 10 files / 600302 bytes read back exactly, and four
public desktop/mobile recovery views passed. See `public-gateway-acceptance.md`.
The following preparation instructions apply to future updates; they are not
outstanding upload instructions for the existing publication.

## Prepare A Candidate

Use a clean source commit:

```sh
npm ci
npm run build
npm run build:gateway
npm run prepare:gateway-update -- /absolute/path/to/previous-publication TRUSTED_PREVIOUS_MANIFEST_SHA256
```

The previous directory must contain every declared old file and the independently
saved old manifest. Do not reconstruct trust from an unverified live host.
The generated `release-artifacts/gateway-update/` contains separate Netlify and
Vercel folders/ZIPs, the exact candidate publication, old publication backup,
gateway profile and unsigned migration plan.
Without the previous-directory arguments, it prepares hosting and candidate
verification artifacts only, not an authorized in-place migration.

Two origins serving the same Tape name resolve the same mutable chain container.
Replacing hosting bootstrap files alone does not update the application.
This migration explicitly removes obsolete/changed old files before uploading
the new release. It can temporarily interrupt the site. Each old file is fully
checked against the saved old publication before a removal is proposed.
Unknown paths, altered old bytes and invalid new prefixes stop the process.
No removal is sent automatically.

## Wallet Migration

Use a separate migration profile with `previousManifestSha256`, the original
publisher/container and reviewed or explicitly disclosed observed code pins.
The budget must include all removal and upload operations.
`maxGasPerTransaction * maxFeePerGasWei * operationCount` is a conservative
arithmetic ceiling, not a gas estimate or authorization.

```sh
npm run publish:wallet -- migration-profile.json TRUSTED_NEW_MANIFEST_SHA256 \
  migration-journal.json 4188 \
  release-artifacts/gateway-update/publication \
  release-artifacts/gateway-update/previous-publication
```

The browser displays the removal count and temporary unavailability before fee
consent. Every operation still requires a separate original-wallet confirmation.
Do not reset an existing journal or use a fresh journal to bypass a pending request.
The new manifest, prior manifest and profile budgets are bound to the journal.
Recheck actual fees and read back all files before moving to public acceptance.
Retain the old files for an explicitly reviewed rollback; there is no automatic rollback.

## Hosting And Acceptance

Deploy `Netlify-Gateway.zip` to the existing Netlify site and the Vercel folder
to the existing Vercel project using authenticated hosting access.
Do not replace the chain application with hosted copies while labeling it verified.

```sh
npm run verify:live-gateway -- \
  release-artifacts/gateway-update/profile.json \
  docs/gateway-recovery-task-67042.json
```

To recheck the already published version, dispatch "Verify public TapeExit gateways"
and choose `published`, or use `docs/published-gateway-profile.json` instead of the
generated candidate profile in the command above.
For a future rebuilt publication choose `candidate`. `historical` checks the original
733ca79 release and cannot accept the new candidate. Candidate workflow builds its
expected profile from its own clean source; an older chain release fails its manifest check.

Acceptance uses fresh desktop/mobile Chromium contexts. It checks exact manifest
and file bytes, Tape identity, activation, same-origin Service Worker and layout.
For the backup origin, an HTTPS CONNECT proxy must demonstrably block the primary,
including Service Worker connections. The same saved mainnet transaction is then
verified through the recovery form on both origins. Exported arrivals, remaining
liquidity, account, NFT and finality must match the supplied task.
Screenshots and exports are retained under `release-artifacts/live-gateway/`.

This is read-only recovery acceptance. It does not prove target extension signing,
independent gateway upstreams, a clean physical device or independent safety review.
No user transaction is sent by the acceptance runner.
