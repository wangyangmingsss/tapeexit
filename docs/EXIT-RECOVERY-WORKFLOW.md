# Wallet Exit And Transaction Recovery

The existing controlled mainnet test remains limited to the original account,
position #67042, the fixed USDt0/USDC pair, the fixed reduction and collection caps,
and the original persistent journal. A completed test cannot be repeated by
reloading, timing out or importing a recovery file.

## Wallet And Arrival Workflow

The controlled-test page retains its existing preview, explicit amount/fee consent,
reservation-before-wallet, exact transaction checks and durable submission block.
Wallet account reads and the wallet response now have 90-second deadlines. A
deadline does not cancel an extension request or prove that no transaction was
broadcast. A late valid hash is still preserved against the original reservation.

After a hash is saved, pending inclusion or finality can trigger another read-only
check after three seconds. There are at most ten checks per manual start. Success,
revert, unexpected errors and explicit stop end the automatic loop. No retry sends
another wallet transaction. Reload can resume verification of an already saved hash.

The existing full-journal export is preserved. The new cross-gateway export contains
only chain, manager, original account, position ID and transaction hash.

## Recovery In Another Browser Or Gateway

The application recovery form can import that public identity file or a new
recovery-verification report. Imports are limited to 64 KiB and the configured
chain/manager. Extra executable, destination or approval fields are rejected.
Imported outcomes never become current success results.

The browser saves only public transaction identity, not a successful outcome.
After refresh, the form restores that identity and requires a fresh chain check.
Waiting for inclusion/finality supports a three-second, ten-check maximum loop.
Editing inputs, cancelling, disabling automatic checks or encountering conflicting
evidence stops the loop. Clearing recovery hints never clears a pending submission.

## Release Scope

These changes do not approve assets, provide an independent review, alter the
production signing gate, reset a test journal or establish a new mainnet wallet
acceptance result. The previously published source remains `0d9ff56` until a
separate publication of new exact application bytes is completed.

Focused checks:

```sh
npx vitest run tests/recovery-task.test.ts tests/recovery-check.test.tsx tests/controlled-test.test.ts tests/controlled-test-server.test.ts
npm run typecheck
```

Browser coverage is in `controlled-test.spec.ts` and
`transaction-recovery.spec.ts`. The provider responses in those tests are fixtures,
not observations of the installed OKX extension.
