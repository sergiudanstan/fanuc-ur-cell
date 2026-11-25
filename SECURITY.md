# Security Policy

This is a static, browser-only digital twin: a single generated `index.html` with no
backend, no accounts, no cookies and no data sent anywhere. It runs three.js 0.186.1 vendored under `vendor/three/` (no CDN). The only
browser storage it uses is `localStorage` for the theme and render-quality preference.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ Current |

Single maintainer; only the latest release receives fixes.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Report it privately:
**[Report a vulnerability](https://github.com/sergiudanstan/fanuc-ur-cell/security/advisories/new)**
(Security → Advisories → Report a vulnerability).

| Stage | Target |
|---|---|
| Acknowledgement | within 3 business days |
| Triage | within 10 business days |
| Fix, or a documented decision not to fix | within 90 days |

These are best-effort targets from a single unpaid maintainer, not a contractual SLA.
There is no bug bounty; credit is offered in the advisory and changelog.

## Scope

In scope: script injection into the page (for example through URL parameters or values
the page writes with `innerHTML`), the page loading code from any origin other than its
pinned dependency URLs, and anything in this repository's workflows that could publish a
release not built from `main`. Also in scope: The vendored copy of three.js under `vendor/three/` (a modification to it that differs from the npm 0.186.1 release is in scope; vulnerabilities in three.js itself are not), and the local-only test server in `tests/scene.mjs`.

Out of scope: vulnerabilities in three.js or the CDN itself (report upstream), the
developer tools under `tools/` run against your own machine (`tools/shots.mjs` and `tools/record.mjs` start a local `python3 -m http.server` on 127.0.0.1 and write stills and a film; they are developer tools and not run in CI.), and the
accuracy of the simulation. That is a correctness bug, file it as a normal issue.

## Supply chain

CI checks that the committed `index.html` equals a fresh build from `src/`, runs the logic
tests and a headless page smoke test on every push, `npm audit` on the test tooling,
`pip-audit` on the hash-pinned CI toolchain, CodeQL, and `zizmor` on the workflows.
Actions are pinned to full commit SHAs and kept current by Dependabot. Releases attach a
source archive with Sigstore build provenance:

```
gh attestation verify fanuc-ur-cell-v0.1.0.tar.gz --repo sergiudanstan/fanuc-ur-cell
```
