# CLAUDE.md — Central Tracking

## Project Overview

Central Tracking is a desktop task and time tracking app built with Electron, React, and TypeScript. It uses a local SQLite database (via `better-sqlite3`) and has a plugin architecture for syncing with external systems (Azure DevOps, Jira).

## Architecture

```
src/
  main/              # Electron main process
    main.ts          # App entry point, window creation, IPC registration
    preload.ts       # Context bridge (exposes CentralTrackingAPI to renderer)
    logger.ts        # Debug logger (--debug flag)
    database/        # SQLite database class + migrations
    ipc/             # IPC handlers: tasks, timeEntries, comments, categories, reports
    plugins/         # Plugin system: interface, manager, ADO + Jira scaffold
    __tests__/       # Main process tests
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
- **Database**: SQLite with WAL mode, foreign keys enabled. Schema managed via sequential migrations in `src/main/database/migrations.ts`.
- **Plugins**: Implement the `SourcePlugin` interface (`src/main/plugins/pluginInterface.ts`). Currently scaffolded but not yet functional.
- **Routing**: HashRouter with `/` (tasks) and `/reports` (reporting view).

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
| `npm run build` | Full production build (main + renderer) |
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
| `tasks:*` | Task CRUD (getAll, getById, create, update, delete, reorder) |
| `timeEntries:*` | Time entry CRUD + singleton timer (getByTask, create, update, delete, getActive, stopActive) |
| `timeEntries:getTodayTotal` | Today's aggregate time |
| `timeEntries:getByDateRange`, `timeEntries:getReport` | Reporting queries |
| `comments:*` | Comment CRUD |
| `categories:*` | Category CRUD + assignToTask |
| `reports:exportCsv` | CSV export with save dialog |
| `window:setAlwaysOnTop`, `window:getAlwaysOnTop` | Window management |
| `plugins:list`, `plugins:sync` | Plugin system |

## Testing

- **Framework**: Vitest with jsdom environment
- **Libraries**: @testing-library/react, @testing-library/jest-dom, @testing-library/user-event
- **Test location**: `__tests__/` directories alongside source, with `.test.ts`/`.test.tsx` extensions
- **Mock infrastructure**: `src/test/mocks/` — api.ts (IPC bridge mock), electron.ts (IPC main mock), database.ts (in-memory SQLite)
- **TDD workflow**: Write failing tests first, then implement until tests pass

### Commands

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```
