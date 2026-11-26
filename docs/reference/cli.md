# User guide

[Back to the project home](/)

## Choose a persona

Run `agent-purge web` to open the local console. Edit the neutral template or create a persona in Personas, then apply it in the Console.

```bash
agent-purge ls
agent-purge use <id>
agent-purge mode append
agent-purge sync
```

CLI and Web share state. Switching personas or modes or editing the current body synchronizes the selected channels; failures can be reviewed and retried under Tests & Logs.

The default harness only determines what starts when you run `agent-purge` without arguments. It **does not determine application scope**. Select the relevant channels to make other entry points read the persona.

### Persona files

The default directory is `~/.agent-purge/personas/`; each persona is `<id>.md`:

```markdown
---
id: concise
name: Concise collaboration
description: English, conclusion first, read code before editing
harness: ["*"]
model: ["*"]
order: 10
---

Collaborate in English. Give the conclusion first, then the evidence.
Read the existing implementation before changing code; state uncertainty clearly.
```

Only the body enters the prompt. `description` is used in listings; the older `desc` key is still supported. Web editing preserves metadata not included in the form. `active` is an internal reserved identifier; do not use it as a persona name.

### Configure one harness separately

```bash
agent-purge use concise --for codex
agent-purge mode append --for codex
agent-purge use follow --for codex
agent-purge mode follow --for codex
```

`follow` cancels that field's override. Global pause takes precedence over per-harness mode, and the original selection is retained on resume.

## Modes

| Mode | Behavior | Notes |
|---|---|---|
| `replace` | Approximately remove identity lines from readable host text, then insert the persona | Launch entry points without host-text access use `strict` |
| `strict` | Replace host text in the controllable entry point | Existing instructions there are removed too; the host may add other text |
| `append` | Retain host instructions and append the persona | Identity instructions may conflict |
| `off` | Stop injection at the current entry point | Global pause and one-time launch arguments have different scopes |

CLI launch entry points for `codex`, `claude`, `grok`, `codebuddy`, and `hermes` cannot read host text, so `replace` acts as `strict` and reports this in the terminal. Choose `append` to retain host instructions.

CLI `append` puts the persona after host text; the [magpie plugin](https://github.com/ZiChuanLan/agent-purge/blob/main/magpie-plugin/README.md) puts it before. The actual role may be `system`, `developer`, or project context; see [compatibility](compatibility.md).

## One-time launch

```bash
agent-purge codex
agent-purge pi --persona concise
agent-purge codex --mode append
agent-purge pi --ask "Explain this code"
agent-purge codex --dry-run
agent-purge codex -- --help
```

Arguments after `--` go to the host and are not parsed by agent-purge. `--dry-run` displays the launch command without launching the host.

`--mode off` affects only this launch and does not undo other channels already installed on disk. If those conflict with persistent or project content, first run `agent-purge pause`; do not treat one-time off as a complete uninstall.

## Persistent and project channels

| Channel | What it does | When read |
|---|---|---|
| `install` | Writes managed host configuration or a plugin | New session for static configuration; next turn after a dynamic plugin is loaded |
| `shim` | Places a same-named command ahead on PATH, forwarding to agent-purge | Next launch through that command |
| `slash` | Installs an in-session `/purge` extension | After pi, omp, or dsh loads the extension |
| `project` | Writes a managed block into a selected project rule file | New sessions in that directory |

```bash
agent-purge install codex
agent-purge arm pi --slash
agent-purge arm codex --shim
agent-purge arm pi
agent-purge status
```

`arm <h>` attempts the harness's persistent, command, and slash channels and reports results individually. Not every harness supports every channel. Reload the host after initial installation or plugin code updates. On Linux and macOS, add the shim directory to the shell PATH as instructed by the command.

DSH writes only initialized profiles; it does not create desktop, web, or headless configurations from scratch. Its slash plugin is a switch; injection also requires the persistent plugin. The command reports profiles actually handled. Plugin packages live in the agent-purge data directory (`~/.agent-purge/dsh/<plugin-name>/`) and patches reference them via absolute `file:` URLs, independently of profile `node_modules`. Reinstalling dsh dependencies or cleaning a profile therefore does not disable the plugin.

### Project rules

```bash
agent-purge project on pi --dir /path/to/project
agent-purge project status --dir /path/to/project
agent-purge project off --dir /path/to/project
```

Directories are registered by absolute path. Later synchronization handles only registered directories rather than drifting with the current working directory. Pause retains registration, and resume reapplies the original scope.

The Web **Rule Files** page switches between current-project and global-directory scope and selects the persona to write. It appends a managed block to the original file, preserving existing rules and allowing removal. Files are grouped by rule file: `AGENTS.md`, `CLAUDE.md`, `QWEN.md`, `AGENT.md`, `.clinerules`, and `.roorules` support changing directories, viewing readers and per-tool read relationships, reviewing write diffs and resulting files, and previewing, writing, or removing managed blocks. Actions are recorded. A rule file can be read by multiple tools; writing once affects all readers without selecting a managing owner.

Rule files and system-prompt takeover are independent channels. Disarming all does not touch project blocks. Global pause removes system-layer project blocks and writes them back according to current selections on resume; blocks for rules-only hosts must be removed separately on the project page. Cursor, Devin CLI, Amp, Cline, and Roo Code support only this rules channel, not replacement of the main agent's system prompt. Gemini CLI also has the `GEMINI_SYSTEM_MD` environment variable, and Qwen Code also has a launch-argument channel.

The project channel does not provide a distinct persona per folder; it follows global or per-harness configuration. Other harnesses may also read files named `AGENTS.md` or `CLAUDE.md`. Enabling both project and global entry points can duplicate the persona.

## Pause, undo, and uninstall

| Purpose | Command | Persona data |
|---|---|---|
| Temporarily pause / resume the previous scope | `agent-purge pause` / `agent-purge resume` | Retained |
| Undo only the persistent channel | `agent-purge uninstall dsh` | Retained; slash and shim unaffected |
| Undo all selected channels for one harness | `agent-purge disarm dsh` | Retained |
| Undo all registered takeovers | `agent-purge clean` | Retained |
| Uninstall the npm program | First `agent-purge clean`, then `npm uninstall -g agent-purge` | Retained |
| Permanently delete user data | `agent-purge self-uninstall --yes` | **Deleted; back up first** |

`self-uninstall --dry-run` only previews. Without `--yes`, data is not permanently deleted.

The Windows installer undoes takeovers and removes the program only after uninstall confirmation; canceling does not change configuration. Corrupt configuration or ledger, active-channel restore conflicts, or PATH undo failures still stop uninstall and retain credentials. Old files or custom ledgers that cannot be restored are skipped; backups and ledgers remain in the data directory, with details in `clean-leftovers.log`.

CLI `clean` still checks strictly by default. Only explicit `clean --keep-failed` tolerates the old ledgers above; if items are skipped, its exit code is 3 instead of 0. `--dry-run` does not initialize or migrate data, roll back the journal, or write logs. For ZIP and standalone EXE installations, run `clean` before deleting the program. External edits are preserved. Old or modified DSH plugins may be renamed to `.disabled-by-agent-purge*`; inspect them before handling them yourself.

`arm --all` and `disarm --all` operate both the master switch and harness channels. For temporary disablement, use `pause` rather than a full uninstall. Content already sent in prior sessions cannot be recalled.

## Data and privacy

User data is stored separately from the program, by default:

- Windows: `C:\Users\<user>\.agent-purge\`
- Linux/macOS: `~/.agent-purge/`

This includes personas, `state.json`, and recovery credentials. Upgrades do not overwrite this directory with release contents. To change its location:

```bash
export AGENT_PURGE_HOME=/path/to/ap-data
```

```powershell
$env:AGENT_PURGE_HOME = 'D:\ap-data'
```

PowerShell assignment affects only the current session; `setx` affects subsequently started processes. On first run, data in older package directories is migrated if possible, leaving originals intact.

For isolated tests or investigating detection of a real machine, override detection roots: `AGENT_PURGE_DRIVES` specifies scan roots and `AGENT_PURGE_APP_DIRS` specifies macOS application directories, both separated by `;`. Without them, platform defaults apply.

Configuration and prompt rewriting happen locally; update checks contact GitHub. When enabled, personas are sent with host requests to the configured model service. agent-purge does not provide network isolation. Web listens only on `127.0.0.1`; do not expose it directly to the public internet.

## Troubleshooting

- **No effect after saving**: Run `agent-purge status` and check persona, mode, and channels; start a new session or reload the plugin. Successful configuration writes are not evidence of requests in the current session.
- **Old content after pause**: Existing history is not cleared. Check whether you are still in an old session or have another independent prompt plugin.
- **Restore conflict**: Keep the original files and recovery materials named in the error. Compare and merge changes rather than deleting backups.
- **Windows reports missing Node**: Thin packages and the installer need Node 20+ on PATH; standalone `agent-purge.exe` bundles its runtime.
- **SSH / WSL without a desktop**: Use `agent-purge web --no-open` and open the terminal's address. The default port is `7788`, falling back to `7890–7909` when reserved or occupied. A terminal-hosted service does not exit when the page closes.
- **Desktop window will not close or quits immediately**: In Settings, choose whether closing the window exits the service or keeps it in the background. The adjacent confirmation setting controls whether a prompt appears before closing: a system dialog for native windows, or a page confirmation for browser windows. Changes apply immediately.
- **Whose desktop window is it?** The thin package and installer include `agent-purge-window.exe`, which opens the app's own window using WebView2, without a browser address bar or browser account, and with the agent-purge taskbar icon. `window-profile/` in the data directory stores window size and WebView2 data.
- **Why did Microsoft account sign-in appear before?** Older versions used Chrome or Edge `--app` mode. On first launch, Edge associated an already signed-in system Microsoft account with the new browser profile; testing found neither `--disable-sync` nor `--disable-features=ImplicitSignIn` prevented it. After changing engines, the old profile is discarded and rebuilt. Ownership is recorded in `window-profile/.agent-purge-browser`.
- **When does it fall back to a browser window?** When WebView2 Runtime or `WebView2Loader.dll` is missing, or when using the standalone `agent-purge.exe` or npm installation, neither of which includes the window host. It falls back to Chrome `--app`, then Edge if Chrome is missing, then the system default browser. That window belongs to the browser; Edge may associate the system account with the new profile. This is Edge behavior, and agent-purge does not read or send account information.
- **No window after double-clicking**: An immediate native host launch failure is recorded in `window-profile/window-error.log` (`0xC0000135` means a DLL could not be loaded). The program tries a browser window without restarting the background service; singleton registration uses the fallback window PID. If no browser is available, open the registered address manually. Browser fallback uses `window-profile/browser-fallback/` and does not clear native-window data.
- **Update says no public Release**: This does not mean npm is current. For npm installations check with `npm outdated -g agent-purge`.
- **Persona behavior differs after changing model or relay**: Distinguish whether the request contains the persona from whether the model follows it. The Web safe dry run does not test your real relay. Inspect `system` and `developer` fields before and after the relay. Do not post API keys or complete private personas in public issues; see [verification scope](compatibility.md#验证状态与第三方中转).
