# CLAUDE.md — Central Tracking

## Recurring footgun families

A code-review audit on 2026-05-14 surfaced three patterns that produced most of
the bugs in this codebase. Before adding new code, check whether you're falling
into one of these:

1. **Field-name drift through narrow inline IPC types.** Type the renderer
   side of `preload.ts` with the shared `Create*Input`/`Update*Input` /
   `TaskQueryParams` interfaces from `src/shared/types.ts`, not with inline
   `{...}` types. The original bug: a renderer call passed `filter.status`
   (singular) when the actual field is `statuses` (plural), and TypeScript
   couldn't catch it because the preload param was inline and narrower than
   the renderer-side `CentralTrackingAPI` declaration.

2. **`setX({...x, ...})` inside an effect or handler.** Captures the closure
   value of `x`, which goes stale when two updates land in the same tick or
   before a debounce drains. Always use `setX(prev => ({...prev, ...}))`
   when the update depends on previous state.

3. **`await ipc(id); setState(result)` with no staleness guard.** If the
   user changes selection during the await, `result` is for the old
   selection but overwrites the new one's state. Always capture the id
   locally and bail before setState if it changed (see `currentTaskIdRef`
   in `TaskDetail.tsx`).

## Project Overview

Central Tracking is a desktop task and time tracking app built with Electron, React, and TypeScript. It uses a local SQLite database (via `better-sqlite3`) and includes a CLI (`ct`) for programmatic interaction. The CLI communicates with the running Electron app via a local HTTP server, enabling AI agents and scripts to perform all operations available in the UI.

## Architecture

```
src/
  main/              # Electron main process
    main.ts          # App entry point, window creation, IPC registration, HTTP server startup
    preload.ts       # Context bridge (exposes CentralTrackingAPI to renderer)
    logger.ts        # Debug logger (--debug flag)
    secretStorage.ts # OS-keychain encryption wrapper (safeStorage; enc:v1:<base64> format)
    errors.ts        # DomainError class for structured IPC/HTTP error serialization
    database/        # SQLite database class + migrations
    ipc/             # IPC handlers: tasks, timeEntries, comments, categories, reports, import, cli, plugins
    server/          # Local HTTP server for CLI communication
      httpServer.ts  # HTTP server; delegates routing to apiManifest
      apiManifest.ts # Route table (route, ipcChannel, handler, mutates, event) — shared by IPC + HTTP
      auth.ts        # Token generation, server file management, validation
    reports/         # Pure report logic (no Electron dependency)
      csvGenerator.ts
    import/          # Pure import logic (no Electron dependency)
      importExecutor.ts
      markdownParser.ts
    __tests__/       # Main process tests
  cli/               # CLI tool (`ct`)
    main.ts          # Entry point, yargs command tree
    client.ts        # HTTP client (reads ct-server.json, auth)
    formatters.ts    # Human-readable output (tables, durations, report text)
    commands/        # Command modules: task, timer, time, report, comment, category, import, status, plugin
    __tests__/       # CLI unit + integration tests
  renderer/          # React frontend (webpack-bundled)
    App.tsx          # Root component, wraps providers + HashRouter
    components/      # Layout, Sidebar, TaskList, TaskDetail, TimerBar,
                     # ReportView, DateRangePicker, SplitButton, OptionsMenu,
                     # TimeEntryEditor, HelpPopover, ConfirmDialog,
                     # BatchActionBar, LinkPluginDialog, PluginsSettings,
                     # CategoryPieCharts, TimelineView, MultiSelectDropdown
    context/         # TaskContext (CRUD + filtering), TimerContext (active timer)
    hooks/           # useMarkdownTextarea (Cmd+S save, markdown list continuation)
                     # useIntersectionObserver (infinite scroll sentinel)
                     # usePluginCapabilities (reads plugin config schema for UI feature gates)
    utils/           # Helpers (time formatting, duration parsing, validation)
                     # adoFsm.ts (client-side ADO status transition rules)
  shared/
    types.ts         # Shared TypeScript types (Task, TimeEntry, Comment, etc.)
    dateRange.ts     # Date range helpers (toIsoStartOfDay, toIsoEndOfDay)
  test/              # Test infrastructure
    setup.ts         # Global test setup
    mocks/           # Mock factories (api, electron, database)
plugins/
  ado/               # Azure DevOps sync plugin (stages 0-3: pull, push-time, push-state, push-comments)
```

- **Main ↔ Renderer communication**: IPC via `contextBridge` / `ipcRenderer.invoke`. The API shape is defined in `CentralTrackingAPI` in `src/shared/types.ts`.
- **Main ↔ CLI communication**: Local HTTP server (127.0.0.1) with bearer token auth. CLI discovers the server via `{userData}/ct-server.json`.
- **Real-time UI updates**: HTTP server fires `webContents.send('ct:data-changed')` after mutations. Renderer contexts subscribe and refresh with 100ms debounce.
- **Handler extraction**: IPC handler business logic is extracted as named exports (e.g., `createTask`, `getActiveTasks`). Both IPC registration and HTTP routes call these same functions via `src/main/server/apiManifest.ts`.
- **Database**: SQLite with WAL mode, foreign keys enabled. Schema managed via sequential migrations in `src/main/database/migrations.ts`.
- **Routing**: HashRouter with `/` (tasks) and `/reports` (reporting view).
- **Plugin webhooks**: Mutating HTTP routes carry an `event` field (e.g., `task.updated`). After a mutation, the server dispatches that event to all enabled plugins registered for it.

## CLI (`ct`)

The CLI enables programmatic interaction with the running app. All changes made via CLI appear in the UI in real-time.

```bash
ct [--json] [--debug] [--timeout=SECONDS] <command> [subcommand] [args]

Commands: task, timer, time, report, comment, category, import, status, version, plugin
Global flags: --json (machine-readable output), --debug (log HTTP traffic), --timeout (default 10s)
```

Full per-command reference: `.claude/cli-reference.md`  
Plugin development guide: `docs/plugins.md`

**Keep the CLI reference in sync.** `.claude/cli-reference.md` is generated from
`ct --help`. Whenever you change the `ct` command tree — add/rename/remove a
command or option, or edit help text under `src/cli/` — run `npm run docs` and
commit the regenerated `.claude/cli-reference.md`. A git pre-commit hook
(husky + lint-staged) does this automatically when `src/cli/**` is staged, and
CI fails on drift (`docs-check` on PRs, `verify-docs` on release). The
human-facing `docs/cli.md` is **not** committed — it is published as a release
asset (`npm run docs:cli`).

### Building the CLI

```bash
npm run build:cli    # Compiles CLI to dist/cli/
npm run build        # Full build (main + renderer + CLI)
```

### Server Discovery

On startup, the Electron app writes `{userData}/ct-server.json` containing `{ port, token, pid }`. The CLI reads this file to connect. If the file is missing or the PID is dead, the CLI reports "App not running."

### Security

- Server binds to `127.0.0.1` only (no network exposure)
- Random UUID token per session, required via `Authorization: Bearer <token>`
- Host header validation (DNS rebinding protection)
- No CORS headers (prevents browser-based attacks)
- 1MB request body limit
- Token rotates on each app restart

## Troubleshooting

### Log file

The app writes a persistent timestamped log to `{userData}/central-tracking.log` (trimmed to 2000 lines on startup). Locations:

- **Windows:** `%APPDATA%\central-tracking\central-tracking.log`
- **macOS:** `~/Library/Application Support/central-tracking/central-tracking.log`

Key entries to look for:

| Entry | Meaning |
|---|---|
| `[INFO] ── session start` | Start of a new app session |
| `[ERROR] Renderer process gone — reason: X, exitCode: Y` | Renderer crashed; `reason` values: `crashed`, `oom`, `launch-failed`, `killed`, `clean-exit` |
| `[ERROR] [RENDERER] Unhandled promise rejection: ...` | Async error (failed IPC call, rejected Promise) with stack |
| `[ERROR] [RENDERER] Uncaught error: ...` | Synchronous JS error in renderer with stack |
| `[ERROR] [RENDERER] React render error: ...` | Component threw during render; includes React component stack |

Renderer errors are forwarded to the main process via `ipcRenderer.send('log:renderer', level, message)` before the process has a chance to crash, so they survive even if the renderer dies immediately after.

## Development

```bash
# Install dependencies
npm install

# Development mode (two terminals):
npm run dev              # Compiles main + starts webpack dev server on :3000
NODE_ENV=development npm start   # Launches Electron pointing at localhost:3000

# Production build:
npm run build            # Compiles both main and renderer
npm start                # Launches Electron loading from dist/

# Debug mode (with verbose logging):
npm run start:debug      # Launches with --debug flag
```

### Key scripts

| Script | What it does |
|---|---|
| `npm run dev` | Concurrently watches main TS + serves renderer at :3000 |
| `npm run build` | Full production build (main + renderer + CLI) |
| `npm run build:main` | Compiles main process TypeScript |
| `npm run build:cli` | Compiles CLI TypeScript |
| `npm start` | Launches Electron (`dist/main/main.js`) |
| `npm run start:debug` | Launches with `--debug` flag for verbose logging |
| `npm test` | Runs all tests via Vitest |
| `npm run test:watch` | Runs Vitest in watch mode |
| `npm run test:coverage` | Runs tests with coverage report |
| `npm run lint` | ESLint across `src/**/*.{ts,tsx}` |

**Important:** When running in dev mode, Electron must be started with `NODE_ENV=development` so `main.ts` loads `http://localhost:3000` instead of the built file.

## Code Conventions

- TypeScript strict mode
- React functional components with hooks
- Context-based state management (no Redux)
- CSS files co-located with components (e.g., `Layout.css` next to `Layout.tsx`)
- IPC handlers are organized by domain in `src/main/ipc/`
- Handler business logic extracted as named exports for reuse by HTTP server
- Electron-free modules (`reports/csvGenerator.ts`, `import/importExecutor.ts`) for logic shared between IPC and HTTP
- Structured errors use `DomainError` from `src/main/errors.ts` (code + message); serializes cleanly over IPC and HTTP
- UUIDs for all entity IDs (via `uuid` package)
- SQLite column names use `snake_case`; TypeScript types use `camelCase`

## Database

- Located at `{userData}/central-tracking.db` (Electron's `app.getPath('userData')`)
- Tables: `tasks`, `time_entries`, `comments`, `categories`, `task_categories`, `plugin_config`, `plugins`, `schema_version`
- Migrations are sequential SQL strings in `src/main/database/migrations.ts`
- **Migration 001**: Initial schema (all tables)
- **Migration 002**: `ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT '';`
- **Migration 003**: Indexes for paginated queries
- **Migration 004**: Soft-delete support (`deleted_at` column on tasks)
- **Migration 005**: Plugin registry (`plugins` table for installed plugin metadata)
- **Migration 006**: `ALTER TABLE time_entries ADD COLUMN reported_at TEXT DEFAULT NULL;` (tracks when time was marked as reported to an external system)
- **Migration 007**: External sync fields on tasks (`external_url`, `external_state`, `external_completed_hours`, `external_refreshed_at`, `state_dirty`) and `external_id` on comments; unique index on `(source, external_id)`

## IPC API Surface

| Channel | Description |
|---|---|
| `tasks:*` | Task CRUD (getAll, getById, create, update, delete, reorder, batch ops) |
| `tasks:upsertExternal`, `tasks:setExternalState` | Plugin-driven external task mirroring and state push |
| `tasks:link`, `tasks:unlink` | Manually link/mirror a task to an external plugin work item |
| `timeEntries:*` | Time entry CRUD + singleton timer (getByTask, create, update, delete, getActive, stopActive) |
| `timeEntries:getTodayTotal` | Today's aggregate time |
| `timeEntries:getByDateRange`, `timeEntries:getReport`, `timeEntries:getSummaryReport` | Reporting queries |
| `timeEntries:getByTaskPaginated`, `timeEntries:getByDateRangeWithTasks` | Paginated and cross-task queries |
| `timeEntries:markTaskReported`, `timeEntries:batchMarkReported` | Mark time entries as reported to an external system; batch supports optional date range |
| `comments:*` | Comment CRUD |
| `comments:upsertExternal`, `comments:getPendingSync` | Mirror external comments; query syncable comments needing push |
| `categories:*` | Category CRUD + assignToTask |
| `plugins:list`, `plugins:setEnabled` | Plugin registry queries and enable/disable |
| `plugins:getConfig`, `plugins:listConfig`, `plugins:setConfig`, `plugins:deleteConfig`, `plugins:schema` | Per-plugin config management (secrets encrypted via `secretStorage.ts`) |
| `reports:exportCsv` | CSV export with save dialog |
| `cli:isInstalled`, `cli:install`, `cli:uninstall` | CLI tool install/uninstall (macOS only) |
| `window:setAlwaysOnTop`, `window:getAlwaysOnTop` | Window management |

## HTTP API Surface

All endpoints: `POST /api/{domain}/{operation}` with JSON body `{ "args": [...] }`.

Response: `{ "ok": true, "data": <result> }` or `{ "ok": false, "error": { "code": "...", "message": "..." } }`.

The route table is in `src/main/server/apiManifest.ts` and maps 1:1 to the extracted handler functions. Each route declares:
- `mutates: boolean` — triggers `ct:data-changed` renderer refresh on `true`
- `event?: string` — event name dispatched to plugin webhooks on mutation (e.g. `task.updated`, `comment.created`)

## Testing

- **Framework**: Vitest with jsdom environment
- **Libraries**: @testing-library/react, @testing-library/jest-dom, @testing-library/user-event
- **Test location**: `__tests__/` directories alongside source, with `.test.ts`/`.test.tsx` extensions
- **Mock infrastructure**: `src/test/mocks/` — api.ts (IPC bridge mock), electron.ts (IPC main mock), database.ts (in-memory SQLite)
- **Test layers**: IPC handler tests, HTTP server tests, CLI formatter tests, integration tests (CLI → server → database)

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```
