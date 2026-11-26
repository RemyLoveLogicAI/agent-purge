# Pause and uninstall

## Pause or undo changes

| Purpose | Command | User personas |
|---|---|---|
| Temporarily pause / resume the previous scope | `agent-purge pause` / `agent-purge resume` | Retained |
| Undo one persistent configuration only | `agent-purge uninstall dsh` | Retained; other channels unchanged |
| Undo all selected channels for one harness | `agent-purge disarm dsh` | Retained |
| Undo all registered takeovers | `agent-purge clean` | Retained |

```bash
agent-purge pause
agent-purge resume
agent-purge disarm dsh
agent-purge clean
```

## Uninstall the program

When uninstalling the npm program, undo takeovers before removing it:

```bash
agent-purge clean
npm uninstall -g agent-purge
```

The Windows installer uninstaller also undoes takeovers and retains personas. If a restore conflict occurs, keep the files and credentials named in the error and compare changes before proceeding; **do not simply delete the backup**. Content already sent in past sessions cannot be recalled.

## Permanently delete data

To permanently delete data, back up first, then follow the [uninstall section of the CLI reference](/reference/cli#pause-undo-and-uninstall). `self-uninstall --yes` is different from a normal uninstall.

## Privacy boundaries

- **Local management**: The default data directory is `~/.agent-purge/`, or the corresponding `.agent-purge` directory under the Windows user profile. Override it with `AGENT_PURGE_HOME`. Program upgrades do not overwrite this directory.
- **Model requests still use the network**: Once enabled, personas are sent with host requests to the configured model service. Local management does not mean offline operation. Update checks also contact GitHub.
- **Host permissions are not directly changed**: The project manages prompts and configuration entry points; it does not crack hosts or bypass authorization, and does not guarantee model behavior after rewriting.
- **Use only in environments you are authorized to manage**: The Web console listens only on `127.0.0.1`; do not expose it directly to the public internet. See the [compliance statement](/LEGAL) for the full requirements.
