# Dependency Review

This is an internal engineering record, not an independent audit or approval to sign on mainnet.

## Reproduce The Evidence

```sh
npm ci
npm run build
npm run report:dependencies
npm run report:dependency-scope
```

The inventory reads the lockfile. The scanner invokes `npm audit --omit=dev`, records its observation time and binds its JSON to the lockfile digest. Scanner transport errors and incomplete responses stop report generation.

The scope report compares advisory package paths with the actual production bundler module graph. It verifies the audit digest, lockfile digest, JavaScript chunk hashes and release manifest before writing a result. A previous scope report is removed before validation. Keep all inputs with the resulting `dependency-scope.json`.

## Interpret The Result

| Field | Meaning | Limitation |
| --- | --- | --- |
| `present` | A module path for this installed package occurs in the production graph | May include tree-shaken modules; does not prove that a vulnerable primitive executes |
| `not-observed` | No matching installed package path occurs in this graph | Installation, build and Node tooling remain in scope |
| `via` | Advisory or propagated dependency finding reported by npm | A propagated package severity is not a new direct advisory |
| `exploitability: not-assessed` | No finding is dismissed | Requires source and call-path review by a qualified reviewer |

No clean-security conclusion follows from these classifications. The `--omit=dev` report also does not cover every development-tool advisory.

## Current Decisions

The previous graph contained 22 findings, then 17 after the first targeted fixes.
Overrides pin `tmp@0.2.7`, `diff@8.0.3` and `serialize-javascript@7.1.3`.
This revision also scopes `undici@6.29.1`, `adm-zip@0.6.1` and `uuid@11.1.1`
to Hardhat, and `cookie@0.7.2` to Sentry. The installed audit now reports
9 low findings, with no moderate, high or critical findings. Regenerate the
audit/context and graph report against the exact lockfile before release.

These include major-version overrides, so version ranges alone do not establish
compatibility. Tests execute the actual Hardhat HttpProvider against a local HTTP
server, the compiler ZIP extraction API, UUID generation, Sentry cookie
parse/serialization, solc temporary files and Mocha patch/serialization APIs.
The full official V3 contract suite also runs. This does not validate every
unused Hardhat feature. The official SDK remains at 3.31.8; no mathematical
dependency downgrade or forced audit fix was used.

The registry currently offers elliptic 6.6.1, still inside the advisory range.
The remaining nine low findings include its propagated dependency paths; they
are retained for review rather than suppressed or described as nine separate
direct vulnerabilities. Future updates require fresh registry and audit evidence.

Keep the official SDK and integer mathematics until a compatible, reviewed migration exists. Do not remove event, ownership or transaction checks to reduce bundle size.

TapeExit does not store or sign private keys with ethers/elliptic. Requests go to an injected provider. This narrows one use case but does not establish non-exploitability or resolve the advisory. The dependency installation and build process remains trusted.

Before enabling signing, independently review each direct advisory and its propagated paths against the exact source commit, module graph and lockfile. Record the reviewer, findings, actual compatible fixes and retest. Mainnet signing stays disabled while those gates are incomplete.
