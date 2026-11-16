# Sponsorship and Release-Package Readiness

**Status: preparation only. No sponsorship application, public release, package publication, or fundraising claim has been made.**

## 1. What we are asking supporters to support

Cletus is an experimental, simulation-first open-source software effort intended to make digital-asset research and risk information more understandable and to give people more control over whether they participate. The public-benefit case must be demonstrated through working software, transparent testing, security practices, documentation, and community contribution—not promises of returns.

Funding requests must be specific about:
- The engineering work and public artifacts being supported.
- What is already implemented versus proposed or untested.
- The current simulation-only / no-live-funds status of any public demo.
- Known limitations, security assumptions, operating costs, and use of funds.
- How progress, spending, and setbacks will be reported.

Never claim guaranteed profits, passive income, financial freedom, a proven trading edge, production readiness, autonomous safety, or an endorsement that has not actually been granted.

## 2. GitHub Sponsors eligibility and account-side tasks

GitHub's current personal-account setup guidance says a sponsored developer must contribute to an open-source project, live in a supported region, complete a sponsored developer profile and tiers, submit bank and tax information, enable GitHub two-factor authentication, and request GitHub approval. GitHub says review may take a few days after the request. Organization sponsorship has a separate organization-owner flow.

The account owner must personally complete identity/contact, payout, tax, and 2FA steps. These private account details must never be placed in this repository or sent to an agent.

Before applying:
1. Decide whether Cletus will genuinely be an open-source project and which components will be public.
2. Confirm the contributor's region is supported by GitHub Sponsors.
3. Enable GitHub 2FA.
4. Complete the GitHub Sponsors profile, transparent tiers, bank/fiscal-host setup, and tax forms in GitHub's own interface.
5. Submit the request for approval and wait for GitHub's decision.
6. Only after approval, add a real sponsor destination to `.github/FUNDING.yml` on the default branch and enable the repository's Sponsorships feature.

**Important program boundary:** GitHub Sponsors is for supporting open-source contribution. Do not describe sponsorship as a way to buy, sell, promote, or finance an ICO, utility token, or other cryptocurrency. Keep any future token proposal separate from the open-source sponsorship request and obtain legal review before any token fundraising or distribution.

## 3. Current repository blockers to resolve before public package release

The repository was checked while preparing this document:
- The repository is currently private.
- `package.json` currently sets `"private": true`, which prevents ordinary npm publication.
- No repository `LICENSE` file was found.
- The project is a full Next.js application, not yet a clearly scoped reusable library package.
- The current trading evidence does not establish a profitable strategy; keep all public claims simulation-first and evidence-based.
- Open pull requests and deployment restrictions mean the default branch is not yet a complete representation of every proposed feature.

These are facts to resolve, not reasons to rush a public release. Do not flip the repository public, change the package to publishable, or choose a license without the owner explicitly approving the legal and intellectual-property consequences.

## 4. Package/release endorsement preparation

There is no single generic "package endorsement" that can be claimed in advance. The exact program or marketplace must be identified. Independently of the target, prepare a trustworthy release package:

- Choose the actual distribution target: a container image, a hosted application release, or a separately scoped SDK/library. Do not publish the whole app as an npm library merely because it has a `package.json`.
- Select and review an appropriate license; confirm ownership and third-party license compatibility.
- Remove `private: true` only for the package that is intentionally being published, after review.
- Add a release changelog, semantic versioning policy, installation and rollback instructions, supported Node/runtime versions, configuration reference, and a clear support policy.
- Add CI for tests, type-check, production build, migration validation, dependency review, secret scanning, static analysis, and supported runtime versions.
- Generate a Software Bill of Materials (SBOM) for each release.
- Use signed tags/releases and build provenance/attestations where the selected registry supports them.
- Publish checksums, artifact provenance, vulnerability reporting instructions, and a security contact.
- Provide a reproducible demo with no wallet signing, no live trading, no secrets, and no payment collection.
- Have an independent security review before any production or financial functionality is promoted.

No package, badge, partner status, security certification, or endorsement may be advertised until the relevant provider has actually granted it.

## 5. Public-facing evidence pack

The following should be assembled and kept current:
1. A concise project overview and architecture diagram.
2. A feature matrix labelled **implemented / experimental / planned / not available**.
3. A demo URL and reproducible local setup guide.
4. CI status and test results, including known failures.
5. Security model, threat model, incident contact, and responsible disclosure process.
6. Privacy/data-flow summary and retention/deletion approach.
7. Risk disclosure and adult-eligibility gate documentation.
8. Backtest methodology, data limits, fees/slippage assumptions, and negative results as well as positive results.
9. A roadmap with milestones and transparent use-of-funds estimates.
10. Contributor guide, code of conduct, license, and maintainer responsibilities.

## 6. Work order

1. Finish and review age/risk/financial-consent onboarding; verify the gates in middleware and API handlers.
2. Reconcile the default branch and open PRs; run CI, type-check, and production build.
3. Resolve secrets, database ownership, migrations, backups, and deployment/worker architecture.
4. Complete the public demo and document precisely what it can and cannot do.
5. Decide licensing, public-source boundaries, and whether a separately scoped package is needed.
6. Add supply-chain controls, SBOM, release process, and vulnerability disclosure.
7. Publish evidence and invite independent review.
8. Complete the GitHub Sponsors application through the account owner's own dashboard; add `FUNDING.yml` only after the sponsor profile is approved.
9. Apply to the specific package/marketplace program only after its name and eligibility requirements are confirmed.

## 7. Non-negotiable boundaries

- Sponsorship is support for open-source contribution, not an investment product or token sale.
- No sponsor receives trading access, preferential financial outcomes, or a share of trading returns.
- No private keys, recovery phrases, API keys, bank details, or tax forms in issues, PRs, logs, screenshots, or agent prompts.
- No live trading, token minting, staking, lending, custody, or money movement as part of a sponsorship demo.
- Do not claim GitHub, a registry, a security auditor, or any partner endorses Cletus unless that endorsement is verified in writing.
