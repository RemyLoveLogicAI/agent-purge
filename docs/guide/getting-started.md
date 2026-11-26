# Getting started

## Requirements

You need **Node.js 20 or later** and must first install the coding agents you want to manage locally. agent-purge does not bundle models or credentials.

## Install

```bash
npm install -g agent-purge
agent-purge web
```

You can also run `npx agent-purge web` without installing globally.

## Get started in three steps

1. In **Personas**, edit the starter template or create a persona. Bulk pulls from GitHub repositories or local directories are supported.
2. Return to the **Console**, select a persona and default mode, save settings, then enable the target tools or open their details to tune channels.
3. Under **Rule Files**, append managed rule blocks to selected project directories or global configuration directories. Blocks are appended to the existing file by default and can be removed without loss.

The console normally listens on `http://127.0.0.1:7788`. If the port is reserved or in use, it falls forward to an available port in `7890–7909` and opens a standalone desktop window. The thin package and installer use the bundled WebView2 window host; without WebView2, they fall back to Chrome or Edge `--app` mode. The desktop app is single-instance: launching again brings the open window to the foreground. The Settings page controls appearance (automatic, light, or dark, also switchable with the top-bar sun/moon button), close behavior (quit or stay in the background and whether to confirm), and WebDAV backup. Changes apply immediately. **No tool is automatically armed on first launch.**

## Platforms and installation formats

| Format | Requirements | Use |
|---|---|---|
| npm | Node.js 20+ | Install and upgrade with npm |
| `agent-purge-<version>-setup.exe` | Windows, external Node.js 20+ | Graphical installation and removal |
| `agent-purge-<version>.zip` | Windows, external Node.js 20+ | Extract and run |
| `agent-purge.exe` | Windows x64, bundled runtime | Standalone portable executable without a separate Node installation |
| `agent-purge-<version>-darwin-arm64.dmg` / `x64.dmg` | macOS 12+ (Apple Silicon / Intel, bundled runtime) | Unsigned `.app` disk image; drag into `/Applications`, then right-click Open or use `xattr -cr` on first launch |
| `agent-purge-<version>-linux-x64` / `-linux-arm64` | Major Linux distributions, bundled runtime | Single-file binary; run after `chmod +x` |
| `agent-purge-<version>-linux-<arch>.tar.gz` | Major Linux distributions | Portable package with `.desktop`, icon, and root-free `install.sh` |
| `agent-purge-<version>-linux-<arch>.deb` | Debian, Ubuntu, and derivatives | `sudo apt install ./*.deb`; registers `/usr/bin/agent-purge` and a desktop entry |
| `agent-purge-<version>-linux-<arch>.AppImage` | Major Linux distributions, when available | Double-click or use `--appimage-extract-and-run` to launch the console |

Available downloads are listed in [GitHub Releases](https://github.com/ZiChuanLan/agent-purge/releases); unreleased versions have no attachments. Check SHA-256 and signature status. Unsigned programs can trigger system warnings. The EXE inside the ZIP is a thin launcher, not the standalone version with a bundled runtime.

For SSH, WSL, and other environments without a desktop, use `agent-purge web --no-open`. The Web console listens only locally. On Linux, use npm, source, or release binaries, `.tar.gz`, or `.deb`; an AppImage is optionally generated depending on runner capabilities. On macOS, use npm, source, or a `.dmg` image; the `.dmg` is not signed or notarized by Apple. See [compatibility](/reference/compatibility) for platform verification coverage.

## Upgrade

The version badge in the upper right of the console opens the upgrade path appropriate to the installation:

- Standalone EXE: download and replace in place.
- Global npm installation: run `npm install -g`.
- **Source checkout** (`git clone`, then run `node bin/agent-purge.mjs`): run `git pull --ff-only` in the installation directory; no release artifacts are downloaded.

For a source checkout, update detection compares upstream commits and can report updates even if the version number has not changed. It refuses and explains why if the working tree has uncommitted changes, HEAD is detached, or the branch has no upstream.

## Next steps

- [Personas and modes](/guide/personas-and-modes): what the four modes change.
- [Application scope](/guide/scope): one-time launch, persistent, command takeover, and project rule channels.
- [Support matrix](/reference/support): measured purge and residue for each host.
