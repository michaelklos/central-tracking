# CLAUDE.md — Central Tracking

## Project Overview

Central Tracking is a desktop task and time tracking app built with Electron, React, and TypeScript. It uses a local SQLite database (via `better-sqlite3`) and includes a CLI (`ct`) for programmatic interaction. The CLI communicates with the running Electron app via a local HTTP server, enabling AI agents and scripts to perform all operations available in the UI.

## Architecture

```
src/
  main/              # Electron main process
    main.ts          # App entry point, window creation, IPC registration, HTTP server startup
    preload.ts       # Context bridge (exposes CentralTrackingAPI to renderer)
    logger.ts        # Debug logger (--debug flag)
    database/        # SQLite database class + migrations
    ipc/             # IPC handlers: tasks, timeEntries, comments, categories, reports, import
    server/          # Local HTTP server for CLI communication
      httpServer.ts  # HTTP server with route table mapping to handler functions
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
    commands/        # Command modules: task, timer, time, report, comment, category, import, status
    __tests__/       # CLI unit + integration tests
  renderer/          # React frontend (webpack-bundled)
    App.tsx          # Root component, wraps providers + HashRouter
    components/      # Layout, Sidebar, TaskList, TaskDetail, TimerBar,
                     # ReportView, DateRangePicker, SplitButton, OptionsMenu,
                     # TimeEntryEditor
    context/         # TaskContext (CRUD + filtering), TimerContext (active timer)
    utils/           # Helpers (time formatting, duration parsing, validation)
  shared/
    types.ts         # Shared TypeScript types (Task, TimeEntry, Comment, etc.)
  test/              # Test infrastructure
    setup.ts         # Global test setup
    mocks/           # Mock factories (api, electron, database)
```

- **Main ↔ Renderer communication**: IPC via `contextBridge` / `ipcRenderer.invoke`. The API shape is defined in `CentralTrackingAPI` in `src/shared/types.ts`.
- **Main ↔ CLI communication**: Local HTTP server (127.0.0.1) with bearer token auth. CLI discovers the server via `{userData}/ct-server.json`.
- **Real-time UI updates**: HTTP server fires `webContents.send('ct:data-changed')` after mutations. Renderer contexts subscribe and refresh with 100ms debounce.
- **Handler extraction**: IPC handler business logic is extracted as named exports (e.g., `createTask`, `getActiveTasks`). Both IPC registration and HTTP routes call these same functions.
- **Database**: SQLite with WAL mode, foreign keys enabled. Schema managed via sequential migrations in `src/main/database/migrations.ts`.
- **Routing**: HashRouter with `/` (tasks) and `/reports` (reporting view).

## CLI (`ct`)

The CLI enables programmatic interaction with the running app. All changes made via CLI appear in the UI in real-time.

### Usage

```bash
ct [--json] <command> [subcommand] [args] [flags]
```

### Commands

```bash
# Tasks (<id> accepts full UUID, prefix, or task name substring)
ct task list [--done|--deleted|--all] [--search X] [--status X] [--source X] [--category ID] [--sort X] [--limit N] [--full-id]
ct task get <id>
ct task create <title> [--description X] [--status X] [--category ID...]
ct task update <id> [--title X] [--status X] [--description X] [--notes X]
ct task delete <id> [<id2>...]
ct task restore <id> [<id2>...]
ct task purge --id <id> | --all
ct task reorder <id1> <id2> ...
ct task batch-update <id1> <id2> --status done [--category ID]

# Timer
ct timer start <task-id>
ct timer stop
ct timer status

# Time entries
ct time list <task-id> [--limit N] [--offset N]
ct time add <task-id> --start ISO --end ISO [--note X]
ct time add <task-id> --duration 1h30m [--note X]
ct time update <id> [--start X] [--end X] [--note X]
ct time delete <id>
ct time today

# Reports
ct report summary --from DATE --to DATE
ct report detail --from DATE --to DATE
ct report chart --from DATE --to DATE
ct report export --from DATE --to DATE [--out file.csv]

# Comments
ct comment list <task-id>
ct comment add <task-id> <body> [--syncable]
ct comment delete <id>

# Categories
ct category list
ct category create <name> [--color "#hex"]
ct category update <id> [--name X] [--color X]
ct category delete <id>
ct category assign <task-id> <cat-id>...

# Import
ct import preview <file|->
ct import execute <file|-> [--skip-existing] [--update-existing] [--dry-run]

# Plugins
ct plugin install <manifest-file>
ct plugin list
ct plugin enable <id> | disable <id> | uninstall <id>
ct plugin config get <id> <key> | set <id> <key> <value> | list <id> | delete <id> <key>
ct plugin run <id>

# Utility
ct status
ct version
```

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

### Plugins

External integrations run as separate processes and interact with the app
through the CLI plus optional webhook subscriptions.

**Plugin manifest (`plugin.json`):**

```json
{
  "id": "ado",
  "name": "Azure DevOps Sync",
  "version": "0.1.0",
  "entrypoint": "node sync.js",
  "events": ["task.created", "task.updated", "timeEntry.created"],
  "webhook": { "url": "http://127.0.0.1:9901/ct-events" }
}
```

Webhook URLs must be loopback-only (`127.0.0.1`, `localhost`, or `[::1]`).
Events are the `event` fields declared in `src/main/server/apiManifest.ts`
(e.g. `task.created`, `timeEntry.stopped`, `category.deleted`). Use `"*"` to
match everything.

**Lifecycle:**

```bash
ct plugin install ./plugin.json   # persists manifest in the plugins table
ct plugin list                    # shows id/version/enabled/webhook
ct plugin disable <id>            # stops webhook delivery
ct plugin enable <id>
ct plugin uninstall <id>          # also clears the plugin's config
```

**Configuration** (uses the `plugin_config` table):

```bash
ct plugin config set ado api-key $ADO_TOKEN
ct plugin config get ado api-key
ct plugin config list ado
```

**Running a plugin:**

```bash
ct plugin run ado
```

`ct plugin run` spawns the manifest's `entrypoint` with env vars:
`CT_PLUGIN_ID`, `CT_SERVER_URL` (loopback), and `CT_TOKEN` (session bearer
token). The plugin can call back into the HTTP API with that token, and
verify incoming webhook signatures with the same token.

**Webhook payloads** are JSON with shape
`{ event, route, data, timestamp }` and carry these headers:

- `X-CT-Signature: sha256=<hex>` — HMAC of the body using the session token
- `X-CT-Plugin-Id: <id>`

Delivery is best-effort: failures are logged to the main process stderr and
never block the originating mutation.

**Alternative (no plugin install required):** scripts can drive the CLI
directly for one-shot syncs.

```bash
external-tool list --json | ct import execute - --update-existing
ct task create "External Item" --source plugin
ct time add <task-id> --duration 2h
```

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

### Important: NODE_ENV

When running in dev mode, Electron must be started with `NODE_ENV=development` so `main.ts` loads `http://localhost:3000` instead of the built file.

## Code Conventions

- TypeScript strict mode
- React functional components with hooks
- Context-based state management (no Redux)
- CSS files co-located with components (e.g., `Layout.css` next to `Layout.tsx`)
- IPC handlers are organized by domain in `src/main/ipc/`
- Handler business logic extracted as named exports for reuse by HTTP server
- Electron-free modules (`reports/csvGenerator.ts`, `import/importExecutor.ts`) for logic shared between IPC and HTTP
- UUIDs for all entity IDs (via `uuid` package)
- SQLite column names use `snake_case`; TypeScript types use `camelCase`

## Database

- Located at `{userData}/central-tracking.db` (Electron's `app.getPath('userData')`)
- Tables: `tasks`, `time_entries`, `comments`, `categories`, `task_categories`, `plugin_config`, `schema_version`
- Migrations are sequential SQL strings in `src/main/database/migrations.ts`
- **Migration 001**: Initial schema (all tables)
- **Migration 002**: `ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT '';`

## IPC API Surface

| Channel | Description |
|---|---|
| `tasks:*` | Task CRUD (getAll, getById, create, update, delete, reorder, batch ops) |
| `timeEntries:*` | Time entry CRUD + singleton timer (getByTask, create, update, delete, getActive, stopActive) |
| `timeEntries:getTodayTotal` | Today's aggregate time |
| `timeEntries:getByDateRange`, `timeEntries:getReport` | Reporting queries |
| `comments:*` | Comment CRUD |
| `categories:*` | Category CRUD + assignToTask |
| `reports:exportCsv` | CSV export with save dialog |
| `window:setAlwaysOnTop`, `window:getAlwaysOnTop` | Window management |

## HTTP API Surface

All endpoints: `POST /api/{domain}/{operation}` with JSON body `{ "args": [...] }`.

Response: `{ "ok": true, "data": <result> }` or `{ "ok": false, "error": { "code": "...", "message": "..." } }`.

The route table in `src/main/server/httpServer.ts` maps 1:1 to the extracted handler functions. Each route is tagged with `mutates: boolean` to trigger UI refresh notifications.

## Testing

- **Framework**: Vitest with jsdom environment
- **Libraries**: @testing-library/react, @testing-library/jest-dom, @testing-library/user-event
- **Test location**: `__tests__/` directories alongside source, with `.test.ts`/`.test.tsx` extensions
- **Mock infrastructure**: `src/test/mocks/` — api.ts (IPC bridge mock), electron.ts (IPC main mock), database.ts (in-memory SQLite)
- **Test layers**: IPC handler tests, HTTP server tests, CLI formatter tests, integration tests (CLI → server → database)

### Commands

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```
