# Development

How to build, run, and test Central Tracking from source. For end-user install/upgrade instructions, see the [README](../README.md).

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 41 |
| Frontend | React 18, TypeScript 5.5 |
| Bundler | Webpack 5 (with webpack-dev-server for HMR) |
| Database | SQLite via better-sqlite3 |
| State management | React Context |
| Routing | react-router-dom v6 (HashRouter) |
| Charts | Recharts |
| Testing | Vitest, @testing-library/react |
| IDs | UUID v4 |

## Prerequisites

- Node.js (LTS recommended)
- npm

## Install

```bash
npm install
```

## Running in development

Run in two terminals:

```bash
# Terminal 1: Start the compiler + dev server
npm run dev

# Terminal 2: Launch Electron in dev mode
NODE_ENV=development npm start
```

The renderer dev server runs on `http://localhost:3000` with hot reloading. Electron loads from this URL when `NODE_ENV=development` is set.

## Production build

```bash
npm run build
npm start
```

## Building the CLI

```bash
npm run build:cli     # Compile CLI to dist/cli/
npm link              # Makes `ct` available globally
```

Or run directly:

```bash
node dist/cli/cli/main.js --help
```

The CLI requires the Electron app to be running. It discovers the server via `{userData}/ct-server.json`. See the [CLI reference](https://github.com/michaelklos/central-tracking/releases/latest/download/cli.md) for the full command list, or run `npm run docs:cli` to generate it locally.

## Git hooks

`npm install` sets up a [husky](https://typicode.github.io/husky/) pre-commit hook (via `lint-staged`). When you stage changes under `src/cli/**`, it runs `npm run docs` and re-stages the regenerated `.claude/cli-reference.md`, so the committed CLI reference never drifts from `ct --help`. If you commit with `--no-verify`, run `npm run docs` yourself — CI (`docs-check`) will otherwise flag the drift on your PR.

## Debug mode

```bash
npm run start:debug
```

Running with `--debug` adds `[DEBUG]` lines for HTTP traffic between the CLI and the app to the [log file](../README.md#troubleshooting).

## Testing

The project uses **Vitest** with `@testing-library/react` for component testing. Tests follow a TDD approach.

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode for development
npm run test:coverage # Run with coverage report
```

### Test structure

- `src/test/` — Test infrastructure (setup, mocks)
- `src/**/__tests__/` — Test files co-located with source
- Backend tests use in-memory SQLite databases
- Frontend tests use mocked `window.api` (IPC bridge)

## Project structure

```
src/
  main/              # Electron main process
    main.ts          # App bootstrap, window creation, HTTP server startup
    preload.ts       # Context bridge API
    logger.ts        # Debug logger
    secretStorage.ts # OS-keychain encryption wrapper for plugin secrets
    errors.ts        # DomainError class for structured IPC/HTTP errors
    database/        # SQLite database + migrations
    ipc/             # IPC handlers by domain (tasks, timeEntries, comments, categories, reports, plugins)
    server/          # Local HTTP server for CLI communication
      apiManifest.ts # Route table shared by IPC registration and HTTP server
    reports/         # Pure report generation (CSV)
    import/          # Import parsing and execution
  cli/               # CLI tool (`ct`)
    main.ts          # Entry point, yargs command tree
    client.ts        # Server discovery and HTTP client
    formatters.ts    # Human-readable output formatting
    commands/        # Command modules (task, timer, time, report, comment, category, import, status, plugin)
  renderer/          # React UI
    App.tsx          # Root component with HashRouter
    components/      # Layout, Sidebar, TaskList, TaskDetail, TimerBar,
                     # ReportView, DateRangePicker, SplitButton, OptionsMenu,
                     # TimeEntryEditor, BatchActionBar, LinkPluginDialog,
                     # PluginsSettings, CategoryPieCharts, TimelineView,
                     # MultiSelectDropdown
    context/         # TaskContext, TimerContext
    hooks/           # useMarkdownTextarea, useIntersectionObserver, usePluginCapabilities
    utils/           # Helpers (time, duration, validation, adoFsm)
  shared/
    types.ts         # Shared TypeScript types
    dateRange.ts     # Date range helpers
  test/              # Test infrastructure and mocks
plugins/
  ado/               # Azure DevOps sync plugin (pull sprint items; push time/state/comments)
```

## Further reading

- [CLI reference](https://github.com/michaelklos/central-tracking/releases/latest/download/cli.md) — full `ct` command documentation (published per release; `npm run docs:cli` to build locally)
- [Packaging & releases](releasing.md) — building distributables, CI releases, code signing
- [Plugin development](plugins.md) — manifest format, lifecycle, webhooks
