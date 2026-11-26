# Personas and modes

The persona body determines the prompt provided to the harness; its name and description are only for management. The first run creates the `neutral` starter template. Edit it in the Web console or create your own Markdown file.

```bash
agent-purge ls                       # List personas
agent-purge use <id>                 # Switch and synchronize selected scopes
agent-purge mode append              # Change the global mode
agent-purge use <id> --for codex     # Assign a persona only to Codex
agent-purge use follow --for codex   # Follow the global setting again
```

## Four modes

| Mode | Behavior | Notes |
|---|---|---|
| `replace` (default) | Prefer replacing host identity lines while preserving other instructions where possible | Identity detection is approximate; launch entry points that cannot read host text use strict behavior |
| `strict` | Replace host text in the controllable entry point with the persona | Existing instructions in that entry point are also removed; the host may still add other text |
| `append` | Keep host instructions and add a persona | Does not replace the original identity; watch for conflicting rules |
| `off` | Stop injection at that entry point | Global pause and one-time launch arguments have different scopes |

**Strict does not mean the model receives only the persona.** The actual role may be `system`, `developer`, or project context, depending on the host and channel. To preserve host instructions, try `append` first.

The mode determines **how injected text is written**, not **where it is injected**. When the host has no full system-prompt entry point, all four modes only append. See the per-host [support matrix](/reference/support).

## Write a persona

Save the following as `~/.agent-purge/personas/concise.md`, then run `agent-purge use concise`:

```markdown
---
id: concise
name: Concise collaboration
description: English, conclusion first, read code before editing
---

Collaborate in English. Give the conclusion first, then the evidence.
Read the existing implementation before changing code; state uncertainty clearly.
```

Only the body enters the prompt. `description` is used in listings; the older `desc` key is still supported. Web editing preserves unrelated metadata. See the [CLI reference](/reference/cli#人设文件) for advanced matching, ordering, and data-directory configuration.

The maintainer's [some-magic persona repository](https://github.com/ZiChuanLan/some-magic) is another reference.

## Persona sources

- **Web editor**: edit body and metadata on the persona library page.
- **Local import**: `agent-purge persona import <dir>` bulk-imports `.md` files from a directory.
- **Repository pull**: `agent-purge pull [repo]` pulls from GitHub by default.

## Override per host

Each host's details in the console let you override the global persona and mode. The override affects only that host; select follow global to return to the default.
