# Architecture and interface conventions

## Module boundaries

- `bin/agent-purge.mjs` parses the CLI; `web/server.mjs` provides the local control API.
- Both entry points apply configuration through `lib/apply.mjs` rather than implementing different installation or pause semantics.
- `lib/state.mjs` manages configuration; `lib/activation.mjs` resolves the final enabled state.
- `lib/persist.mjs`, `lib/slashes.mjs`, `lib/shim.mjs`, and `lib/project.mjs` manage different channels.
- `lib/footprints.mjs` and `lib/restore.mjs` retain write ownership and recovery credentials; failures must not erase recovery material.
- `backends/` handles host launch arguments; `lib/capture.mjs` and `bench/` handle request-level verification.
- User data is separate from the installation directory. Program upgrades must not overwrite personas or state.

## Product conventions

The Web interface is a configuration console, not an embedded interactive terminal. Default launch settings, channel scopes, form drafts, and saved state are shown separately.

Distinguish written configuration, historical tests, and actual effect in the current session:

- Loaded dynamic plugins read changes on the next turn; static entry points require a new session.
- Initial plugin installation and code updates require reloading the host.
- Show failures individually, retain drafts, and allow retrying.
- Pause retains channel selections; undoing takeovers must be clearly distinguished from deleting user data.

## UI foundations

Use native HTML, CSS, and JavaScript without a frontend framework or external fonts.

| Purpose | Convention |
|---|---|
| Page / surface | `#f6f7f9` / `#ffffff` |
| Body / secondary text | `#101828` / `#344054` / `#5d6b81` |
| Action color | `#2459cf`, hover `#1d4ab2` |
| Status colors | Success `#067647`, warning `#93370d`, error `#b42318`; always include text |
| Font | System Chinese font; 14px body, 22px headings; monospace for paths |
| Spacing / corners | 4/8px spacing system; 6/8/12px corner radii |

The console, persona library, verification, and diagnostics share navigation. Expand only one harness's details at a time rather than exposing every technical path on the home page.

New interfaces must provide visible focus, keyboard access, clear errors, and reduced-motion support. Verify at 1440/768/390/320px without horizontal page overflow. Refresh must not overwrite unsaved edits; confirm before leaving a dirty form.
