# Support status

This page describes the supported scope and verification at the time of testing. Request-level verification covers only the hosts explicitly listed and is not a compatibility promise for all versions.

## Purge approaches

The entry point a host provides determines whether its identity is **replaced** or the persona is **only appended**:

| Approach | Meaning | Hosts |
|---|---|---|
| Full replacement | The host exposes an entire system prompt entry point; the persona replaces the original prompt, leaving the persona and tool descriptions | CodeBuddy, Kimi, Qoder, Claude*, Grok, omp |
| Identity replacement | The host permits only its identity section to be replaced; tool descriptions and operating rules remain | pi, Codex, Qwen, Kilo, OpenCode 1.x / 2.x, DSH |
| Append | **No full replacement entry point; the persona is appended and the original identity remains** | Antigravity, Continue, Goose, Crush, zcode |
| Client field only | The system prompt is assembled server-side, with only one replaceable client field; changing it does not prove the server-side prompt was replaced | Auggie |
| Unverified | No measured system-prompt character count; purge is not claimed | pi-desktop, WorkBuddy, WorkBuddy AI, Kiro |

*Claude may support partial or full replacement depending on a binary patch, which is not included in this repository. Its SDK prepends “You are a Claude agent, built on Anthropic’s Claude Agent SDK.”, leaving 62 characters.*

The classification and measurements are in `matrix.json` under `purgeKind`. Tests enforce consistency with `defaultSystemChars` and `purgedSystemChars`; an unspecified `purgeKind` defaults to replacement.

## Measured built-in safety clauses

What purge removes depends on where the host places safety clauses. The counting rule is **one independent guardrail instruction per line**: refusals, content policy, injection defense, disclosure prevention, and permission gates each count. The 2026-11-14 rerun covered 17 hosts × four modes (off, strict, replace, append), or 68 requests, using real binaries in isolated HOME directories and capturing request bodies with a loopback mock provider.

| Host | System characters in off | Built-in guardrails | After purge | Notes |
|---|---|---|---|---|
| CodeBuddy | 17,264 | 7 | 0 | Five MUST-refuse clauses in `<content_policy>` (politically sensitive topics, pornography, illegal activity, privacy and defamation, false news and impersonation of institutions), plus priority over user instructions even in test, academic, or hypothetical scenarios, and an IMPORTANT clause refusing authorized security testing. |
| Claude | 27,278 | 3 | 1 | Refuses DoS, large-scale targeting, supply-chain disruption and detection evasion; requests reports of suspected prompt injection; and treats downloaded files and extracted archives as untrusted. The first two are in system and disappear in replace; the third is in a user-role system-reminder, which replace does not touch. |
| Qoder | 13,742 | 3 | 1 | Refuses destructive techniques, DoS, large-scale attacks and supply-chain disruption, and requests reports of prompt injection. **The instruction not to disclose the system prompt and underlying model remains**: two CLI string constants add back a 133-character prefix to every `--system-prompt`. |
| **DSH** | 2,729 | **4** | **2** | `web_search` and `web_fetch` each say external content is data, not instructions, in system and remain after replace. `file policy: workspace-write` and `Approval policy: ask … fails closed` are in runtime context, removed by context name, while the approval hook permits automatically. Only strict removes all four. |
| Qwen / Kimi / Continue / Goose | 19,403 / 10,357 / 1,318 / 7,387 | 0 | 0 | No refusal clauses in system prompts. Qwen's “Security and Safety Rules” are coding hygiene, such as explaining dangerous commands and not committing secrets, not content policy. |
| Kilo / OpenCode 1.x / OpenCode 2.x | 13,717 / 14,236 / 12,888 | 0 | 0 | The only similar instruction is the opposite: offer alternatives rather than lecturing when unable to help. |
| Codex / Grok / omp / pi | 23,107 / 5,121 / 10,588 / 2,398 | 0 | 0 | No safety clauses in system prompts. |
| Antigravity | 16,440 | 0 | 0 | Only `<identity>`, `<guidelines>`, `<artifacts>`, `<subagents>`, and `<skills>`; no clauses to remove. |
| Crush | 22,180 | 0 | 0 | Persona uses the install channel, a managed `CRUSH.md` block, with no full replacement entry point. The host prompt is client-side in the developer element of `input[]`, beginning “You are Crush…”. The capture measured 26 tool definitions and 22,180 system characters; only a clean off capture is available, not full numbers for all four modes. |
| Kiro / Auggie / zcode | — | Not measured | Not measured | Kiro 3.3.0 sends no request without login (`Not logged in`), so even pointing `HTTPS_PROXY` at loopback cannot determine proxy use; the binary has no `KIRO_ENDPOINT`, `KIRO_BASE_URL`, or custom-provider overrides and uses AWS CodeWhisperer. Auggie's off client sends a zero-character `system_prompt` and empty `rules`; its host prompt is built server-side. zcode is Electron desktop-only and its main process does not read `HTTP_PROXY`; capture would require installing a MITM root certificate in the OS trust store, outside this project's evidence scope. |

**Conclusion:** The observed built-in guardrails occur in CodeBuddy, Claude, Qoder, and DSH. CodeBuddy has none after replace. **Qoder retains one** hardcoded disclosure restriction, **Claude retains one** in a user-role system-reminder, and **DSH retains two** system-level injection defenses unless strict is used. Antigravity has none in its prompt; blocking occurs in Google's policy classifier, outside local purge.

Method: one line per independent guardrail instruction, counting strong signals only (refusal, content policy, injection defense, disclosure prevention, permission gates), excluding ordinary coding conventions such as `must not`.

## Support matrix

| Host | Version | Channel | Hot switch | Approach | off → replace (system characters) |
|---|---|---|---|---|---|
| pi | 1.5.2 | Session extension | Supported (`/purge`) | Identity replacement | 2,398 → 1,053 |
| omp | 18.14.1 | Plugin | Supported | Full replacement | 10,588 → 569 |
| OpenCode 1.x | 1.19.5 | Plugin | Supported | Identity replacement | 14,236 → 14,184 |
| OpenCode 2.x | 2.2.5 | Plugin | Supported | Identity replacement | 12,888 → 12,868 |
| DSH | 0.2.1-rc.5 | Configuration / SDK / plugin | Supported | Identity replacement | 2,729 → 2,733 |
| Codex | 0.166.0 | Launch arguments / rules | New session | Identity replacement | 23,107 → 6,048 |
| Claude Code | 2.1.323 | Launch arguments / rules | New session | Full replacement (62-character SDK identity remains) | 27,278 → 255 |
| CodeBuddy | 2.179.0 | Launch arguments / rules | New session | Full replacement | 17,264 → 120 |
| Grok | 1.0.73 | Launch arguments / rules | New session | Full replacement | 5,121 → 114 |
| Qwen Code | 0.27.3 | `--system-prompt` / `--append-system-prompt` | New session | Identity replacement | 19,403 → 5,677 |
| Continue CLI | 1.5.47 | `--rule` | New session | Append | 1,318 → 1,477 |
| Qoder CLI | 1.1.89 | `--system-prompt` / `--append-system-prompt` | New session | Full replacement (133-character prefix remains) | 13,742 → 248 |
| Kimi Code | 2.6.2 | `--agent-file` | New session | Full replacement | 10,357 → 114 |
| Goose | 1.58.1 | `session/run --system` | New session | Append | 7,387 → 7,504 |
| Kilo Code | @kilocode/cli 7.8.18 | `code.md` / AGENTS.md | New session | Identity replacement (`soul()` prepends "You are Kilo") | 13,717 → 5,353 |
| Antigravity (agy) | 1.5.12 | `~/.gemini/config/AGENTS.md` | New session | Append | 16,440 → 16,906 |
| Auggie CLI | 0.37.1 | `--override-system-prompt` / `--rules` | New session | Client field only | Client sends 0 characters in off |
| Kiro CLI | 3.3.0 | `--agent` / custom agent | New session | Full replacement | Not measured |
| Crush | v0.101.0 | `CRUSH.md` / AGENTS.md | New session | Append | 22,180 → 22,180 |
| zcode | 3.16.3 | Configuration / hook | New session | Append | 9,359 → 9,359 |
| WorkBuddy / WorkBuddy AI | 5.9.3 / 5.9.4 | `app-config.json` | New session | Unverified | Not measured |
| pi-desktop | 0.21.0 | `SYSTEM.md` / plugin | Supported (new session; same session depends on model) | Unverified | Not measured |

Machine-readable data is in the `safety` field of `matrix.json`: `off` is the count without injection, `purged` the count after injection, and `null` means no capture. Tests check consistency with `purgeKind`: replacement must leave zero, partial replacement can leave residue only when `residue` explains it, and append cannot claim removal.

### How the measurements were obtained

`bench/capture-system.mjs` runs each host in four modes, with one **real request** per mode:

1. Create an isolated HOME, directing `USERPROFILE`, `APPDATA`, and `XDG_*` to temporary directories so host configuration is not inherited.
2. Start a loopback mock provider returning valid responses for each host's protocol: OpenAI Chat or Responses, Anthropic Messages, or native Gemini.
3. Point each host's configuration to the provider: Qwen uses `--openai-base-url`, Kimi uses `[providers.*]` in `config.toml`, Qoder uses `providers` and `security.auth.useExternal` in `settings.json`, Continue uses `CONTINUE_GLOBAL_DIR` and `config.yaml`, and Goose uses `GOOSE_PROVIDER=openai` and `OPENAI_HOST`.
4. Put a unique marker in the persona and count it in the captured request to detect missing or duplicate injection.
5. Extract system-layer text using the applicable protocol and count characters and guardrail lines.

The `off → replace` figures were measured on the same machine with the same mock provider and session, rather than copied from documentation.

## Detailed records

See [compatibility and known limitations](/reference/compatibility) for captures across the four modes, anomalies, and known pitfalls by host.
