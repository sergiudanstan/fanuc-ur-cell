# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-25

First tagged release of the FANUC + UR5e assembly cell digital twin as published at https://sergiudanstan.github.io/fanuc-ur-cell/: twelve gear-motor housings each receiving a cover and four screws, a FANUC LR Mate 200iD/7L line-tracking an infeed belt and a UR5e with a camera station.

### Added
- `package.json` as the single version source, with `playwright-core` (test tooling only).
- Headless page smoke test (`node tests/smoke.mjs`) run in CI on every push and pull request.
- CI runs the existing logic tests (schedule, mutexes, IK, joint limits, clearance, determinism and the fixture-overlap perturbation; drawn TCP against the logic samples in headless Chrome, with every non-127.0.0.1 request blocked), their negative probes, and a check that the committed `index.html` equals a fresh build from `src/`.
- CI, CodeQL, OpenSSF Scorecard and a tag-triggered release workflow with build
  provenance; Dependabot for actions and npm.
- `SECURITY.md`, `CONTRIBUTING.md` and this changelog.

[Unreleased]: https://github.com/sergiudanstan/fanuc-ur-cell/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sergiudanstan/fanuc-ur-cell/releases/tag/v0.1.0
