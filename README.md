# Central Tracking

A desktop task and time tracking application built with Electron, React, and TypeScript. Designed as a personal productivity hub that consolidates tasks from multiple sources — ad-hoc items, email follow-ups, meeting prep — with a CLI (`ct`) for programmatic access by AI agents and scripts.

## Features

- **Task management** — Create, edit, reorder, and organize tasks with statuses (todo, in-progress, done, blocked) and sources (ad-hoc, email, meeting-prep, plugin, ado)
- **Task lifecycle** — Complete/reactivate tasks with auto-stop/start timer, collapsible "Done" group
- **Time tracking** — Start/stop timer per task, view elapsed time, track daily and total time per task, cumulative "Today" total in timer bar
- **Manual time entries** — Add completed time entries manually, edit existing entries with validation
- **Reported time** — Mark time entries as reported to an external system; unreported-time badges per task; batch mark across multiple tasks with optional date range
- **Notes** — Free-form notes per task with indicator badges and dedicated tab
- **Categories & labels** — Color-coded categories that can be assigned to tasks for filtering; pie chart breakdown in report view
- **Comments** — Add notes to tasks, with optional sync-to-external-system flag; external comments can be mirrored in (read-only)
- **Reporting** — Date range picker, stacked bar chart and timeline visualization (recharts), category pie charts, CSV export
- **Filtering** — Search tasks by text, filter by status, source, category, or unreported-time flag; date range filter on task lists
- **External sync** — Link tasks to external work items (ADO); pull state and title from external systems; push time, status, and comments back; `state_dirty` flag tracks unpushed local status changes
- **Plugin task linking** — Manually link any ad-hoc task to an external plugin work item in link mode (ct owns title/notes) or mirror mode (external system is source of truth)
- **Secret storage** — Plugin config secrets encrypted at rest via OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret); never returned in cleartext from bridge or CLI
- **UI productivity** — Split action button, always-on-top pin, settings menu, scrollable panels, batch action bar
- **CLI (`ct`)** — Full-featured command-line interface for all operations; changes appear in the UI in real-time. Supports `--json` for machine-readable output.
- **Agent-friendly** — External integrations (ADO, Jira, custom scripts) use CLI commands rather than in-process plugins
- **Local-first** — All data stored in a local SQLite database; no account or cloud service required

## Documentation

| Doc | What's in it |
|---|---|
| [CLI reference](docs/cli.md) | Full `ct` command documentation (auto-generated from `ct --help`) |
| [Development](docs/development.md) | Building from source, dev mode, testing, project structure |
| [Packaging & releases](docs/releasing.md) | Building distributables, CI releases, code signing |
| [Plugin development](docs/plugins.md) | Manifest format, lifecycle, webhook payloads |

## Installation

Download the latest installer for your platform from the [Releases page](../../releases):

- **macOS** — open the `.dmg` and drag the app into `/Applications`.
- **Windows** — run the NSIS installer (`.exe`). On locked-down corporate machines where the installer is blocked by security policy, download the portable **`.zip`** instead and run `Central Tracking.exe` from the extracted folder — no installer, no admin rights.

All data is stored in a local SQLite database; no account or cloud service is required.

Building from source instead? See [docs/development.md](docs/development.md).

## CLI

The `ct` CLI exposes every operation available in the UI; changes appear in the app in real-time. The CLI requires the app to be running and discovers it via `{userData}/ct-server.json`.

```bash
ct status                           # Check if app is running
ct task list                        # List active tasks
ct task list --search "deploy"      # Search by title/description
ct task create "New task"           # Create a task (appears in UI)
ct task update "deploy" --status done  # Update by name (or ID prefix)
ct timer start <task-id>            # Start timer (UI updates)
ct timer stop                       # Stop timer
ct report summary --from 2026-04-01 --to 2026-04-11  # Text report
ct report export --from 2026-04-01 --to 2026-04-11 --out report.csv
ct task list --json                 # Machine-readable output
```

See the [full CLI reference](docs/cli.md), or run `ct --help` / `ct <command> --help`. To build and install the CLI from source, see [docs/development.md](docs/development.md#building-the-cli).

## Plugins

External integrations run as separate processes that talk to the running app over its loopback HTTP server. Each plugin ships its own README with install steps and configuration.

**Bundled plugins:**

| Plugin | Description | Docs |
|---|---|---|
| `ado` | Azure DevOps work item sync (pull current sprint; push time / state / comments) | [`plugins/ado/README.md`](plugins/ado/README.md) |

**Manage plugins:**

```bash
ct plugin install <manifest.json>  # Register a plugin
ct plugin list                     # Show installed plugins (id, version, enabled)
ct plugin enable <id>              # Re-enable a disabled plugin
ct plugin disable <id>             # Stop running / receiving events
ct plugin uninstall <id>           # Remove plugin and clear its config
ct plugin config set <id> <k> <v>  # Per-plugin configuration
ct plugin run <id> [args...]       # Spawn the plugin's entrypoint
```

Enable/disable also lives in Settings → Plugins inside the app. The "Track reported time" toggle per plugin gates unreported badges and the auto-mark-on-push behaviour for that plugin's tasks.

Writing your own plugin? See [docs/plugins.md](docs/plugins.md) for the manifest format, lifecycle, webhook payloads, and the CLI-only-script alternative.

## Upgrading

User data (database, CLI wrapper, settings) is stored outside the application bundle and survives upgrades on all platforms.

| Platform | Data location |
|---|---|
| macOS | `~/Library/Application Support/central-tracking/` |
| Windows | `%APPDATA%\central-tracking\` |

- **macOS (.dmg):** Download the new `.dmg`, open it, and drag the app onto `/Applications` to replace the existing version. The `ct` CLI updates itself automatically on first launch via the wrapper script.
- **Windows (.exe):** Run the new NSIS installer — it overwrites the existing installation in place. The `ct.cmd` wrapper is rewritten by the installer.
- **Windows (.zip):** For machines where the installer is blocked by security policy, download the `.zip` instead, delete the old extracted folder, and unzip the new one in its place. Your data is unaffected.

Building from source? `git pull && npm install && npm run build` (add `&& npm start` on macOS).

## Troubleshooting

The app writes a persistent log to:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\central-tracking\central-tracking.log` |
| macOS | `~/Library/Application Support/central-tracking/central-tracking.log` |

The file is trimmed to the last 2000 lines on each startup. It captures:

- **`[INFO] ── session start`** — written on every launch; use this to find the relevant session
- **`[ERROR] Renderer process gone`** — written when the renderer crashes, includes `reason` (e.g. `crashed`, `oom`, `launch-failed`) and `exitCode`
- **`[ERROR] [RENDERER] Unhandled promise rejection`** — async errors from IPC calls or React effects, with stack trace
- **`[ERROR] [RENDERER] Uncaught error`** — synchronous JS errors in the renderer
- **`[ERROR] [RENDERER] React render error`** — errors caught by the React error boundary, with component stack

Running with `--debug` adds `[DEBUG]` lines for HTTP traffic between the CLI and the app.

## Roadmap

See [TODO.md](./TODO.md) for planned features and known work items.

## License

MIT
