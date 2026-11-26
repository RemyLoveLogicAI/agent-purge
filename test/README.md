# Test scope

This directory contains repeatable regression source code. Logs, screenshots, captures, and temporary installation trees are not kept here.

| Scope | Files |
|---|---|
| Configuration, application, and lifecycle | `activation`, `apply`, `lifecycle`, `launch` |
| Harnesses and process bridging | `backends`, `harness-adapters`, `regressions`, `hot-switch`, `spawn`, `private-server` |
| Restoration and data safety | `footprints`, `project`, `restore`, `safety`, `update` |
| Web, request verification, and packaging | `web`, `capture`, `verification`, `window`, `release` |
| Gateway plugin | `magpie/` |
| Real browser | `browser/` |

`npm test` discovers top-level `*.test.mjs` files and runs legacy assertion-based tests and plugin tests. `isolate.mjs` sets up a temporary environment before configuration modules are evaluated, avoiding reads or writes to real user configuration.

Run UI tests separately with `npm run test:ui`. Request captures requiring real harnesses are run with `npm run test:harness` and must not be confused with simulated adapter tests.

Name new tests by functionality, not timestamps or process names such as “final-v2”. Commit source code, not output; see [CONTRIBUTING.md](../CONTRIBUTING.md) for the development entry point.
