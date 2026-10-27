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

The previous graph contained 22 findings: 9 high, 2 moderate and 11 low. Compatible automatic fixes did not resolve them.
Targeted overrides now pin `tmp@0.2.7`, `diff@8.0.3` and `serialize-javascript@7.1.3`; the initial install scan reports
17 remaining findings (7 high, 1 moderate, 9 low). Regenerate the audit/context and graph report for the current lockfile
before using that count as release evidence. Compatibility probes cover solc temporary files, Mocha patch application
and serialization; the full contract suite must also pass. The offered force operation would downgrade the official
mathematical dependency and has not been applied.

Keep the official SDK and integer mathematics until a compatible, reviewed migration exists. Do not remove event, ownership or transaction checks to reduce bundle size.

TapeExit does not store or sign private keys with ethers/elliptic. Requests go to an injected provider. This narrows one use case but does not establish non-exploitability or resolve the advisory. The dependency installation and build process remains trusted.

Before enabling signing, independently review each direct advisory and its propagated paths against the exact source commit, module graph and lockfile. Record the reviewer, findings, actual compatible fixes and retest. Mainnet signing stays disabled while those gates are incomplete.
