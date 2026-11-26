---
layout: home

hero:
  name: agent-purge
  text: One persona for multiple local coding agents
  tagline: Local prompt and persona orchestration · zero production dependencies · byte-reversible writes
  image:
    src: /logo.svg
    alt: agent-purge
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Support matrix
      link: /reference/support
    - theme: alt
      text: GitHub
      link: https://github.com/ZiChuanLan/agent-purge

features:
  - title: One persona, many entry points
    details: CLI and Web share a persona library and ledger, supporting one-time launches, persistent configuration, in-session <code>/purge</code> hot switching, and project rules by directory.
  - title: Clear capabilities, independent overrides
    details: Tools follow the global persona and rewriting mode by default but can be overridden individually. The interface shows only measured channels and modes, without fake switches.
  - title: Hot switching with clear limits
    details: Dynamic channels with per-turn callbacks, including Pi, omp, OpenCode, and dsh, apply changes on the next turn. Static configuration and launch arguments require a new session.
  - title: Atomic and reversible
    details: Original bytes are saved in a <code>stash</code> snapshot before each write and restored when disabled. Project rules support diff preview and SHA conflict detection.
  - title: Local-first, zero production dependencies
    details: No external backend or configuration uploads. Data lives in a separate directory (default <code>~/.agent-purge/</code>) and upgrades do not overwrite user personas.
  - title: Measurements available
    details: Isolated-HOME request captures support each host's purge effects, built-in safety clauses, and residual text. Tests reject numbers that contradict measurements.
---

## The problem

Coding agents ship system prompts containing product identity, behavioral rules, refusal clauses, and tool instructions. Working your way can require repeatedly editing incompatible configurations, and mistakes can be hard to undo.

agent-purge brings those entry points together: **inject one persona into chosen hosts, and restore their originals with one command.**

## Two ways to use it

::: code-group

```bash [Console]
agent-purge web
```

```bash [Command line]
agent-purge codex --mode replace
agent-purge use concise
agent-purge arm pi --slash
```

:::

## Read the measurements first

Purge capabilities differ substantially by host. The project documents those differences:

- **Full replacement**: Codex, OpenCode, DSH, Claude, Qwen, Qoder, Kimi, Kiro, CodeBuddy, Grok, and omp expose a full system-prompt entry point, allowing the persona to replace the native prompt. WorkBuddy 5.11.3 uses plugin cache entry points (`welcomemode-*/prompt.tpl` and `interactionmode-*/fragments/*.md` under `~/.workbuddy/plugins/cache/workbuddy-builtin/`); the desktop app does not read the main prompt template under the installation directory's `resources/templates/`.
- **Partial replacement**: Claude retains a 62-character identity sentence; Kilo prepends an identity through `soul()`.
- **Append only**: Antigravity, Crush, Continue, Auggie, Goose, and zcode do not expose a full replacement entry point, so the native identity remains in the prompt.

See the [support matrix](/reference/support) and [compatibility and known limits](/reference/compatibility) for per-host evidence, measured lengths, and built-in safety clause data.

## Interface

![agent-purge console overview](/images/console-desktop.png)

System-prompt takeover is managed in the Console. Project directories and per-tool global rule files are written from the Rule Files page by scope and selected persona.

![agent-purge rule files](/images/project-rules.png)
