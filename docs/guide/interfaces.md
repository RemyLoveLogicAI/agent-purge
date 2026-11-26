# Console and interfaces

![agent-purge console overview](/images/console-desktop.png)

## Console

System-prompt takeover is managed in the **Console**. Each tool has a row showing its status, channels, mode, and when changes take effect. Expand the details on the right to override its persona and mode, dry-run the actual command, or disconnect that tool.

![agent-purge tool details and safe dry run](/images/console-detail.png)

- **Status** distinguishes enabled, paused, failed, and project file states.
- **Channels** show options supported by measured capabilities. Unsupported options are disabled with an explanation rather than presenting fake switches.
- **Dry run** (`--dry-run`) prints the command that would run without writing files or starting a process.

## Rule files

Manage project directories and global rule files for each tool (`AGENTS.md`, `CLAUDE.md`, `QWEN.md`, `CRUSH.md`, `.clinerules`, and `.roorules`) from the **Rule Files** page, by scope and selected persona.

![agent-purge rule files](/images/project-rules.png)

- Supports global and project scopes.
- Provides a diff preview and SHA conflict detection before writing.
- Appends a managed block by default, which can be removed without loss at any time.

## Persona library

Edit persona text and metadata, copy, import, or pull personas from a repository. The body determines the prompt; names and descriptions are used only for management.

## Mobile

On narrow screens the console collapses to a single column while channels and status remain visible.

![Mobile layout](/images/console-mobile.png)

## Appearance and theme

The console offers light and dark color schemes and follows the system by default.

- The sun/moon button at the right of the top bar switches between light and dark immediately and saves the choice.
- The appearance setting has three states: automatic (follow system), light, and dark.
- The server injects `data-theme` from the saved setting on first render, avoiding a white flash in dark mode.
- The dark palette is checked against WCAG 2.1 AA contrast requirements, with browser end-to-end tests covering five pages.
