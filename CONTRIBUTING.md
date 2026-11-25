# Contributing

Thank you for helping maintain agent-purge. Before submitting, describe the issue with minimal steps to reproduce it and add regression tests for behavior changes.

## Local development

```bash
npm ci --ignore-scripts
npm run check:repo
npm test
npm run web
```

Node.js 20 or later is required. Production code has no third-party npm dependencies. Playwright and axe are used only for development testing.

## Repository structure

```text
bin/             CLI entry point
lib/             State, channels, recovery, processes, and verification services
backends/        Launch adapters for each harness
web/             Native HTML / CSS / JavaScript console
magpie-plugin/   Optional gateway plugin
bench/           Evaluation tools for request capture and CLI armor
test/            Isolated regression, plugin, and browser tests
scripts/         Build, release package validation, and repository checks
packaging/       Windows installer scripts and launcher source
docs/            User guides, compatibility, architecture, and release notes
```

`bench/` is not disposable test output: `agent-purge verify` and `armor` depend on its modules, which must be retained in the runtime package. Test source code and temporary test results are different things.

## Test commands

| Command | Scope |
|---|---|
| `npm run check:repo` | Git-trackable files, exclusion of private/generated files, documentation links, release allowlist |
| `npm test` | Core logic, file recovery, harness adapters, Web API, and plugin regressions |
| `npm run test:package` | Offline installation of the actual npm tarball, CLI/Web assets |
| `npm run test:ui` | Three browsers, four widths, keyboard and automated accessibility checks |
| `npm run test:harness` | Actual host request capture; requires the corresponding hosts to be installed locally |
| `npm run test:artifacts` | Windows ZIP and standalone EXE validation |

Before the first browser test, run:

```bash
npx playwright install chromium firefox webkit
npm run test:ui
```

On Windows, an existing Edge installation can be used: `$env:PLAYWRIGHT_CHANNEL='msedge'; npm run test:ui -- --project=chromium`.

Core tests use a temporary HOME and must not read or write real personas, host configuration, or credentials. Real-host tests use a local test provider by default; this is not a complete operating-system network sandbox. Do not delete failing tests or represent mocked callbacks as real-machine passes just to get tests to pass.

## Submission guidelines

- Keep `package-lock.json` and update it when development dependencies change.
- Put new tests in `test/` and browser tests in `test/browser/`; do not scatter one-off debugging scripts in the root.
- Put test output, raw requests, and development logs in `out/`; put build artifacts in `dist/`. Neither belongs in Git or npm.
- `.pi/`, `.opencode/`, personal `personas/`, `state.json`, and `.env` are local data; do not force them into Git with `git add -f`.
- Keep only current product screenshots in `docs/images/`, and only versions of icons actually used by the code.
- Check `git status --short` and `git diff --check` before submitting. Do not commit all local files indiscriminately.

CI runs repository checks and tests, but does not replace code review or publish automatically. [Architecture conventions](docs/reference/architecture.md) · [Release process](docs/releasing.md)
