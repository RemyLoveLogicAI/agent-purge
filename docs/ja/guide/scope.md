# Application scope

Hosts expose more than one takeover entry point, with different scopes and activation times. Decide which layer you want to cover before choosing a channel.

## Four channels

| Channel | What it does | When it takes effect |
|---|---|---|
| `install` | Writes managed host configuration or a plugin | Static configuration requires a new session; a loaded dynamic plugin reads it on the next turn |
| `shim` | Forwards launches through a command of the same name on PATH | Next launch using that command |
| `slash` | Installs the in-session `/purge` extension | Depends on host extension and enabled state |
| `project` | Writes project rule files in a specified directory | New sessions in that directory |

```bash
agent-purge install codex
agent-purge arm pi --slash
agent-purge project on pi --dir /path/to/project
agent-purge status
```

`arm <h>` attempts every persistent, command, and slash channel available for that harness and reports each result. The project channel must be selected separately. A persona may be duplicated if it is provided through multiple entry points, so enable only the scopes you need.

## One-time use

For one-time use, launch through agent-purge without registering a persistent channel:

```bash
agent-purge codex --mode append
agent-purge pi --ask "Explain this code"
agent-purge codex -- --help          # Arguments after -- go to the host
```

## Why activation timing differs

- **In-session hot switching** (`command` / `state`): The process rebuilds the system prompt each turn. Pi, pi-desktop, and omp use the `before_agent_start` hook; OpenCode and dsh plugins read state each turn. Settings changes apply on the next turn. Exception: pi-desktop sends replacement as a mid-session system patch, so a model that does not accept the patch will not show the change in that session.
- **New session required**: `system` is assembled only at startup. Claude, Codex, Grok, Kiro, Antigravity, and others fall into this group; reopen the session after changes.

See the [support matrix](/reference/support) for each host's hot-switch capabilities.

## Shared project rules

The same rule can be written into a host's own rule file for a directory, for sessions in that directory to read. This suits cases such as using a concise style in one repository while leaving others at their defaults. A diff preview is available before writing, and undo restores the original bytes.

## magpie gateway

The optional magpie gateway plugin is in the repository's `magpie-plugin/` directory, not its root. See that directory's README for installation and the gateway's rewriting boundaries.
