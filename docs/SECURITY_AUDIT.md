# Security audit — redesign/gold-ecosystem (2026-11-17)

Scanners: Semgrep 1.185 (p/default, p/javascript, p/typescript, p/react, p/nextjs, p/secrets),
`npm audit --omit=dev`. Snyk (SCA + Code) not run: the Snyk CLI is not authenticated yet.

## Dependencies (npm audit, production)
| | critical | high | moderate |
|---|---|---|---|
| before | 1 | 17 | 24 |
| after | 0 | 19* | 20 |

Fixed:
- `next` 14.2.35 → 15.5.29 (critical: unauthenticated RCE in the Image Optimization API, plus
  SSRF / middleware-bypass / DoS advisories). React 18 → 19 as Next 15 requires.
  Code migrated to async `cookies()` and async route `params`; `next.config.js` moved to
  `serverExternalPackages` (instrumentation is on by default in 15).
- `ws` → ^8.23.0 and an override `ws@^8` → ^8.23.0 (memory disclosure / DoS in nested copies).
- Override `postcss@^8` → ^8.5.33 (source-map file disclosure in the copy bundled with Next).

Left (*the high count went up only because npm re-rated parents of the same two roots):
- `zod` 3.x (memory DoS on oversized collections) via viem/abitype, `@coinbase/cdp-sdk`, `@reown/appkit-wallet`.
- `decode-uri-component` 0.2.x via `query-string` 7 in WalletConnect.
- `@solana/web3.js` 1.x / `jayson` / `stream-json` (moderate, no fix released).
All are browser-side wallet libraries. The only fix is wagmi 3 / WalletConnect major upgrades,
which change the wallet connector API; do that as its own stage with the wallet E2E suite.

### Re-check after the PR #98 integration (2026-11-17, afternoon)
No dependency changes (package.json / lockfile untouched by the integration). `npm audit --omit=dev`
now reports 0 critical / 36 high / 20 moderate. The increase from 19 is one new advisory plus re-rated parents:
- `picomatch` ReDoS GHSA-fc5q-39xc-vjpf, affected range `*` (no fixed release, so no override is possible).
  Arrives only through `react-native`/`metro`/`jest-util` and `tinyglobby` (pulled in by
  `@solana-mobile/wallet-adapter-mobile`) and WalletConnect `unstorage`/`anymatch`. None of these glob
  untrusted input in the web app; metro is a React Native bundler that never runs on the server.
- Everything else is the same zod / decode-uri-component chain listed above (fixed by wagmi 3 / WalletConnect).
Semgrep re-run (src, scripts, e2e, prisma): 0 high/critical, 15 WARNING, all in the accepted categories above,
0 secrets, nothing new from the integration.

## Code (Semgrep): 0 high/critical, 17 medium (WARNING), 0 secrets
- `bypass-tls-verification` (2 in src/lib/market-data.ts, flow-collector.ts; 11 in scripts/):
  Postgres pool falls back to `rejectUnauthorized:false` when `PG_SSL_CA` is unset, for the
  self-hosted market-data DB with a self-signed cert. Traffic is still encrypted, not CA-verified.
  Accepted for now; set `PG_SSL_CA` to verify. Not changed because it would break the worker's DB link.
- `path-join-resolve-traversal` (src/lib/owner-withdraw-queue.ts): path comes from an env var,
  not user input. False positive.
- `detect-non-literal-regexp` (src/lib/brain/curriculum.ts): regex built from static topic
  keywords, not user input. False positive.
- `github-actions-mutable-action-tag` (ci.yml): actions pinned by tag, not SHA. Low risk, hygiene item.
- 9 Semgrep parse warnings on JSX text containing `&` (parser limitation, not code issues).

## Dependencies (npm audit, full including dev)
`npm audit --omit=dev` is the production picture above. A full `npm audit` (devDependencies included)
adds 2 **Critical** findings that exist only in the test toolchain, plus Vite/esbuild dev-server advisories:

- `vitest` 2.1.9 and its `tinypool` dependency: prototype pollution that can lead to RCE in the
  worker-pool path if an attacker can control certain worker messages.
- `vite` / `esbuild` development-server advisories (not shipped in the production Next.js build).

Mitigation: never expose Vitest UI, Vite, or a public esbuild/Next dev server. These packages are
dev-only and are not in the Vercel production bundle. A Vitest 3/5 upgrade is planned as its own
change after this PR (it can churn the test runner) and was not bundled with these audit fixes.
