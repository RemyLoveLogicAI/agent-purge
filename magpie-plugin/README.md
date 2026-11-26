# magpie gateway plugin

Optional integration: rewrite request prompts passing through the magpie gateway using the same personas and modes as the CLI.

**The plugin entry point is this directory, not the repository root.** The root `package.json` is the CLI; the plugin is not included in the agent-purge npm package.

## Install

```bash
git clone https://github.com/ZiChuanLan/agent-purge
agent-purge ls
node /path/to/agent-purge/magpie-plugin/gen-personas.mjs
magpie plugin add /path/to/agent-purge/magpie-plugin
magpie plugin list
```

Run agent-purge once to initialize personas. After adding or removing personas, rerun `gen-personas.mjs`; the generated `page/personas.js` is local only and must not be committed.

The plugin reads `~/.agent-purge/` and also supports `AGENT_PURGE_HOME`. After switching the CLI persona, the next request through the gateway reads the new setting. Plugin page settings are written to magpie options.

## Configuration

```bash
magpie plugin options magpie-plugin '{"mode":"append"}'
```

The plugin name `magpie-plugin` above follows the installation directory name.

| Field | Purpose |
|---|---|
| `mode` | `off` / `strict` / `replace` / `append` |
| `persona` | Persona identifier |
| `agents` | Limit application to these harnesses (allowlist), for example `["claude","codex"]` |
| `disabledAgents` | Exclude these harnesses (skip rewriting), for example `["claude"]` |

The plugin management page provides visual scope configuration (all, selected only, or exclude selected), presets common agents, and supports adding custom agents, without manually changing JSON options in the CLI.

`off` leaves requests unchanged; `strict` replaces controllable system text; `replace` approximately removes identity lines before inserting the persona; `append` places the persona **before** host text, unlike the CLI, which places it after.

## Boundaries and tests

- Only requests passing through the gateway are handled; client behavior already fixed in place or traffic outside the gateway cannot be changed.
- Strict mode removes tool instruction text from the original system prompt; it does not clear separate structured tool definitions.
- The plugin page cannot read local files directly; the generation script supplies the persona list.
- `npm test` includes hook and page logic regressions without depending on magpie. These tests are not equivalent to real installation acceptance across all magpie versions.

[Main project](../README.md) · [User guide](../docs/reference/cli.md)
