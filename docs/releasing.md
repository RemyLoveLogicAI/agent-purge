# Release process

Building and checking do not commit, push, tag, publish to npm, or create a GitHub Release. `release-check` only uploads an Actions artifact.

## Pre-release checks

```bash
npm ci --ignore-scripts
npm run check:repo
npm test
npm run test:package
npx playwright install chromium firefox webkit
npm run test:ui
```

Also review [compatibility and known limits](reference/compatibility.md). Put raw test output in `out/`; do not commit screenshot drafts, caches, private configuration, or test installation directories.

## Windows build

The build machine needs Node.js 20+, Bun, GCC/g++ (C++17), windres, objdump, and Inno Setup 6. The window host also needs the WebView2 SDK: `scripts/build-window-host.mjs` downloads a pinned version (`1.0.4314.35`) from NuGet, verifies its SHA-256, and caches it in `dist/.cache`; the first build requires network access. `WebView2Loader.dll` is distributed with the package; only headers are used at compile time.

The host must link MinGW runtimes (libgcc, libstdc++, and libwinpthread) with `-static`. The build checks the import table with objdump and fails if MinGW DLLs are included, the checking tool is unavailable, or the table cannot be read. User machines do not have these DLLs, and the host would silently exit with `0xC0000135` (issue #20). A host build failure eligible for fallback removes partial output; a failed executable must not enter the release package. CI currently pins Bun 1.4.4; record the actual toolchain versions for each release.

```bash
npm run build:setup
npm run build:exe
npm run test:artifacts
npm run release:checksums
```

| File | Contents |
|---|---|
| `dist/agent-purge-<version>.zip` | Node thin package and graphical launcher, requiring external Node |
| `dist/agent-purge-<version>-setup.exe` | Thin package installer, requiring external Node |
| `dist/agent-purge.exe` | Standalone Windows EXE with bundled runtime |
| `dist/SHA256SUMS.txt` | Checksums of the three final artifacts |

The `agent-purge.exe` in the ZIP is a thin launcher, **not** the standalone EXE. The installer build checks the thin-package manifest against current source; do not reuse an old directory or mix product versions.

## macOS build

`npm run build:dmg` runs only on macOS. Official releases run `build_mac` in `.github/workflows/release.yml` on `macos-latest`. It uses Bun to compile single-file `darwin-arm64` and `darwin-x64` binaries, packages an `.app` and `AppIcon.icns`, then generates and verifies these with `hdiutil`:

- `dist/agent-purge-<version>-darwin-arm64.dmg`
- `dist/agent-purge-<version>-darwin-x64.dmg`

Artifacts are not Apple `codesign` signed or `notarytool` notarized. Gatekeeper will prompt on first launch; right-click Open or use `xattr -cr` to allow it.

## Linux build

`npm run build:linux` can run locally on Linux. For official releases, `build_linux` in `.github/workflows/release.yml` runs on `ubuntu-latest`. Bun cross-compiles single-file `linux-x64` and `linux-arm64` binaries, and the native architecture runs a real smoke test of `--help`, `status`, `--serve` static assets, and version. Before release, `verify_linux` runs `npm run test:linux-artifacts` on native x64 and ARM64 runners to check hashes, single-file execution, portable installation, Debian installation/run/uninstall, and the optional AppImage. Any failure blocks release.

Artifacts include:

- `dist/agent-purge-<version>-linux-<arch>`: single-file binary with runtime.
- `dist/agent-purge-<version>-linux-<arch>.tar.gz`: portable package with `.desktop`, icon, `LICENSE`, `README`, and root-free `install.sh`.
- `dist/agent-purge-<version>-linux-<arch>.deb`: built with `dpkg-deb`, with metadata and file list read back and checked; installs under `/opt/agent-purge` and registers an entry in `/usr/bin`.
- `dist/agent-purge-<version>-linux-<arch>.AppImage`: generated only if the runner can obtain `appimagetool`; not mandatory.
- `dist/linux-manifest.json`: SHA-256 summary of these artifacts.

Use `--native-only` to build only the current architecture; `--no-deb` and `--no-appimage` disable the respective artifacts. Override the `.deb` maintainer field with `AGENT_PURGE_MAINTAINER`.

## Installation acceptance

`scripts/check-installer.ps1` accepts only temporary Windows Actions runners by default. For local acceptance, explicitly run:

```powershell
./scripts/check-installer.ps1 -AllowLocalMachine
```

The script first checks for an existing installation, desktop shortcut, or Start menu group and refuses to modify anything if found. It uses the system temporary directory, an isolated HOME, and dedicated data to test:

1. Refusal to install without Node, without hanging.
2. Installation in paths with Chinese characters or spaces, CLI application, and reinstalling the same version.
3. Access to Web and static assets through the actual native launcher.
4. Stopping uninstall and retaining credentials on a restore conflict.
5. Uninstall after repair, checking persona and original configuration bytes, registry, and shortcuts.

A locally isolated test is not a fresh system. Before release also check old Node versions, GUI prompts, SmartScreen, upgrades across versions, insufficient permissions, and [known overwrite-install issues](reference/compatibility.md#已知发布限制).

Prefer a disposable Windows runner or VM for installation/uninstallation acceptance: a separate `AGENT_PURGE_HOME` cannot isolate the real Windows registry and known folders. Do not improvise install/uninstall scripts in a primary user directory. PowerShell's `$home` is the built-in read-only `$HOME` and cannot be used for a temporary path. Use a name such as `$fixtureRoot`, stop on errors, and verify absolute paths are inside the dedicated test directory before deletion.

## CI

- `test.yml`: Windows, Ubuntu, and macOS across Node 20, 22, and 24; tarball installation; three-browser UI checks; and Ubuntu `build:linux` artifact build and upload.
- `release-check.yml`: Windows build, ZIP/EXE, install/uninstall, checksums, and candidate package artifact.
- `release.yml`: official release triggered by a version tag or manually; runs full tests and packaging before publishing npm and GitHub Release.
- Actions are pinned to commit SHA. Build jobs are read-only; only the publish job gets `contents: write` and `id-token: write`.
- Remote green runs do not cover local uncommitted changes. Rerun checks on the final commit.

## Official release

`release.yml` is the only automatic release entry point. `release-check.yml` produces candidate artifacts only and does not publish. Before releasing, confirm:

1. The `package.json` version matches the tag (for example, `0.2.11` and `v0.2.11`).
2. The GitHub repository secret `NPM_TOKEN` is an npm automation or granular token with publish permission for `agent-purge`; do not commit it to `.npmrc` or source.
3. Version, changes, license, and compatibility notes have been reviewed and the working tree is clean.

Release with:

```bash
git tag v0.2.11
git push origin v0.2.11
```

The tag push triggers `release.yml`:

1. `verify`: `npm ci`, `check:repo`, all tests, and `test:package` on Windows, Linux, and macOS across Node 20, 22, and 24.
2. `build` / `build_mac` / `build_linux`: respectively build Windows ZIP/EXE/setup and run installer acceptance, build unsigned arm64/x64 `.dmg` on `macos-latest`, and build Linux binaries, `.tar.gz`, and `.deb` on `ubuntu-latest` (AppImage optional); collect artifacts, checksums, and the npm tarball.
3. `verify_linux`: native x64 and ARM64 Linux runners verify and run artifacts for each architecture.
4. `publish`: confirm tag and version match and verify artifact SHA-256 values; run `npm publish --provenance` (skipping an already-published version); create a GitHub Release and upload attachments.

To rerun, use Actions `workflow_dispatch` with the existing tag. Publishing is idempotent: the same npm version is not uploaded twice, and Release assets are replaced using `--clobber`.

Before an official release, review [LICENSE](https://github.com/ZiChuanLan/agent-purge/blob/main/LICENSE), README, and the [legal and compliance statement](LEGAL.md). The software remains MIT licensed; the statement explains risks and responsibilities without adding conflicting licensing restrictions. Keep the README's full statement synchronized when changing it.
