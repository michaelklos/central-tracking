# Azure DevOps Sync

Bidirectional, additive sync between Central Tracking and Azure DevOps:

- **Pull** — mirrors the current sprint's work items into ct as read-only tasks (title, notes, state, link, logged hours).
- **Push time** — sums un-reported time entries per task, rounds to the configured bucket, and increments ADO `Microsoft.VSTS.Scheduling.CompletedWork`.
- **Push state** — pushes ct status changes to the ADO work item state, FSM-bounded.
- **Push comments** — pushes new ct comments to ADO. Mirrored ADO comments are read-only in ct.

The plugin runs as a separate process, talking to the Electron app via its loopback HTTP server. The app must be running.

## Install

```bash
# 1. Build the plugin
npm run build:plugin:ado

# 2. Register the manifest (entrypoint is rewritten to an absolute path)
ct plugin install plugins/ado/plugin.json

# 3. Confirm
ct plugin list
```

If you already had an older copy installed, re-run `ct plugin install` after each `npm run build:plugin:ado` to refresh the manifest snapshot in the plugins table.

## Configure

Set the required keys first. The PAT is declared `secret: true` in the plugin manifest, so it is encrypted at rest via the OS keychain (macOS Keychain / Windows DPAPI / Linux libsecret-kwallet) and never returned in cleartext from `ct plugin config list`. See [`docs/plugins.md`](../../docs/plugins.md#plugin-secrets) for the full standard.

**Required:**

```bash
# PAT: pipe via stdin so the token never lands in your shell history.
echo "$ADO_PAT" | ct plugin config set ado pat --secret-from-stdin

ct plugin config set ado organization <org-slug>
ct plugin config set ado project      <project-name>
```

PAT needs `Work Items: Read & write` (or `Read` only if you'll just `pull`).

**Optional:**

```bash
ct plugin config set ado team                       <team-name>
ct plugin config set ado round-minutes              15
ct plugin config set ado round-mode                 nearest               # nearest|up|down
ct plugin config set ado work-item-types            "User Story,Bug,Task"
ct plugin config set ado pull-closed                false
ct plugin config set ado auto-comment-on-time-push  false
ct plugin config set ado tracks-reported            true                  # see "Reported state tracking"
ct plugin config set ado state-map                  '<json>'              # see below
```

**Inspect what is set / what is missing / which keys are encrypted:**

```bash
ct plugin schema ado          # required, secret, status, env-var-name, description
ct plugin config list ado     # values (secrets masked as [encrypted])
ct plugin config list ado --reveal   # values (secrets in cleartext — be careful)
```

**Sourcing the PAT from a password manager instead of storing it:**

Declared-secret keys honour `CT_PLUGIN_ADO_<KEY>` env vars at plugin-run time, taking precedence over the DB. Example with 1Password CLI:

```bash
export CT_PLUGIN_ADO_PAT="$(op read 'op://Personal/ADO/pat')"
ct plugin run ado sync
```

Non-secret keys do NOT honour env vars (would be surprising). Use `ct plugin config set` for those.

**Linux without a keyring** — if `safeStorage` is unavailable (no libsecret-1-0 / no gnome-keyring / no kwalletd), `ct plugin config set ... --secret` fails with a `NO_KEYRING` error. Install the package for your DE (`gnome-keyring` on GNOME, `kwallet` on KDE) and ensure the session keyring is unlocked before launching the app. As a last resort, re-run with `--allow-plaintext`; the value is stored plaintext and a warning is printed.

### State map

Maps ct status (`todo | in-progress | done`) to ADO state (and vice versa). `blocked` has no ADO equivalent — push-state for a blocked task is a no-op with a warning.

```json
{
  "todo":        { "ado": "New",    "altIn": ["New", "To Do", "Proposed"] },
  "in-progress": { "ado": "Active", "altIn": ["Active", "Committed", "In Progress"] },
  "done":        { "ado": "Closed", "altIn": ["Closed", "Resolved", "Done", "Completed"] }
}
```

- `ado` — ADO state ct pushes when ct status changes to this key.
- `altIn` — ADO states that map back to this ct status on pull.

Default (used when unset) lives at `plugins/ado/src/state-map.ts:DEFAULT_STATE_MAP`.

### Reported state tracking

`tracks-reported` (default `true`) controls how reported state is managed for ADO tasks:

- **`true`** — push-time auto-marks pushed entries as reported. Renderer shows the unreported badge on ADO tasks; batch reported actions apply.
- **`false`** — push-time pushes hours but leaves `reported_at` NULL. Renderer hides the unreported indicator on ADO tasks; batch reported actions auto-hide when the selection is all ADO. Re-running push-time will re-push the same entries because nothing marked them reported — only use this mode if you intend to manage reported state by hand (`ct time mark-reported --tasks <id> ...`).

## Subcommands

```bash
ct plugin run ado pull            # pull current sprint into ct
ct plugin run ado push-time       # push pending time → CompletedWork
ct plugin run ado push            # alias for push-time
ct plugin run ado push-state      # push dirty status changes
ct plugin run ado push-comments   # push pending syncable comments
ct plugin run ado sync            # push-state → push-time → push-comments → pull
ct plugin run ado refresh <id>    # refresh a single ado-source task
```

Push happens before pull in `sync` so a fresh push isn't clobbered by stale ADO data within the same run.

## Periodic sync

Out of the box the plugin runs on demand. To run on a schedule:

### macOS (launchd)

Save as `~/Library/LaunchAgents/com.user.ct-ado-sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.user.ct-ado-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/ct</string>
    <string>plugin</string>
    <string>run</string>
    <string>ado</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key><integer>900</integer>           <!-- every 15 minutes -->
  <key>StandardOutPath</key><string>/tmp/ct-ado-sync.log</string>
  <key>StandardErrorPath</key><string>/tmp/ct-ado-sync.log</string>
</dict>
</plist>
```

Load: `launchctl load ~/Library/LaunchAgents/com.user.ct-ado-sync.plist`.

Sync silently no-ops if the app isn't running (CLI exits with "App not running.").

### Windows (Task Scheduler)

```powershell
$action  = New-ScheduledTaskAction -Execute 'ct.exe' -Argument 'plugin run ado sync'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'CT ADO Sync' -Action $action -Trigger $trigger -RunLevel Limited
```

### Linux (cron)

```cron
*/15 * * * * /usr/local/bin/ct plugin run ado sync >> ~/.cache/ct-ado-sync.log 2>&1
```

## Manual ticket linking

For tasks created in ct (or pulled by another tool) that need to push time to a specific ADO work item:

```bash
ct task link <task-id> --plugin ado --external <work-item-number>          # link-only
ct task link <task-id> --plugin ado --external <work-item-number> --mirror # full mirror
ct task unlink <task-id>
```

- **link-only** — stores the external id. ct keeps ownership of title/notes/status; push-time/push-comments target the ADO item.
- **mirror** — flips `source` to `ado`. Title/notes lock, FSM applies, next pull refreshes state from ADO.

Same UI lives on TaskDetail (Source row → "Link to plugin…" / "Unlink").

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `App not running.` | Electron window isn't open. The CLI reads `{userData}/ct-server.json` to find the loopback server. |
| `Missing required ado config keys: pat, organization, project.` | Run the three required `ct plugin config set ado …` lines above. |
| `push-time: #N PATCH failed: 409` | Concurrent edit in ADO. The plugin retries once; if the second attempt also conflicts, re-run `push-time`. |
| `push-time` reports `tasksSkippedZero` | Total unreported time on those tasks rounded to 0 with the current `round-minutes`/`round-mode`. Time stays unreported and accumulates into the next run. |
| `push-state: #N rejected` | ADO workflow rule blocked the transition. `state_dirty` stays `1`; revisit in ADO. |
| `pull` did not import anything | No work items in current iteration that match `work-item-types`. Adjust the filter or set `pull-closed=true`. |
| State pushed but ct still shows old status | ADO accepted the push but the next `pull` revealed a workflow side-effect (e.g. auto-assigned a new state). ct mirrors ADO on pull. |

## Internals

- All plugin tests live at `plugins/ado/src/__tests__/` and run via the root `vitest` config.
- Plugin compiles standalone with local types in `plugins/ado/src/types.ts`; field drift between plugin and ct is caught at the API boundary, not at compile time.
- Default state map and the FSM mirror (renderer-side at `src/renderer/utils/adoFsm.ts`) are intentionally duplicated — the renderer cannot import plugin code.

For plugin-author docs (manifest format, lifecycle, webhook payloads), see `docs/plugins.md`.
