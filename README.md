# Central Tracking

A desktop task and time tracking application built with Electron, React, and TypeScript. Designed as a personal productivity hub that consolidates tasks from multiple sources — ad-hoc items, email follow-ups, meeting prep — alongside a plugin system for syncing with external tools like Azure DevOps and Jira.

## Features

- **Task management** — Create, edit, reorder, and organize tasks with statuses (todo, in-progress, done, blocked) and sources (ad-hoc, email, meeting-prep, plugin)
- **Task lifecycle** — Complete/reactivate tasks with auto-stop/start timer, collapsible "Done" group
- **Time tracking** — Start/stop timer per task, view elapsed time, track daily and total time per task, cumulative "Today" total in timer bar
- **Manual time entries** — Add completed time entries manually, edit existing entries with validation
- **Notes** — Free-form notes per task with indicator badges and dedicated tab
- **Categories & labels** — Color-coded categories that can be assigned to tasks for filtering
- **Comments** — Add notes to tasks, with optional sync-to-external-system flag
- **Reporting** — Date range picker, stacked bar chart visualization (recharts), CSV export
- **Filtering** — Search tasks by text, filter by status, source, or category
- **UI productivity** — Split action button, always-on-top pin, settings menu, scrollable panels
- **Plugin architecture** — Extensible system for integrating with external task/ticket systems (ADO and Jira scaffolds included)
- **Debug mode** — Verbose logging with `--debug` flag
- **Local-first** — All data stored in a local SQLite database; no account or cloud service required

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 31 |
| Frontend | React 18, TypeScript 5.5 |
| Bundler | Webpack 5 (with webpack-dev-server for HMR) |
| Database | SQLite via better-sqlite3 |
| State management | React Context |
| Routing | react-router-dom v6 (HashRouter) |
| Charts | Recharts |
| Testing | Vitest, @testing-library/react |
| IDs | UUID v4 |

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- npm

### Install

```bash
npm install
```

### Development

Run in two terminals:

```bash
# Terminal 1: Start the compiler + dev server
npm run dev

# Terminal 2: Launch Electron in dev mode
NODE_ENV=development npm start
```

The renderer dev server runs on `http://localhost:3000` with hot reloading. Electron loads from this URL when `NODE_ENV=development` is set.

### Production Build

```bash
npm run build
npm start
```

### Debug Mode

```bash
npm run start:debug
```

## Testing

The project uses **Vitest** with `@testing-library/react` for component testing. Tests follow a TDD approach.

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode for development
npm run test:coverage # Run with coverage report
```

### Test Structure

- `src/test/` — Test infrastructure (setup, mocks)
- `src/**/__tests__/` — Test files co-located with source
- Backend tests use in-memory SQLite databases
- Frontend tests use mocked `window.api` (IPC bridge)

## Project Structure

```
src/
  main/              # Electron main process
    main.ts          # App bootstrap, window creation
    preload.ts       # Context bridge API
    logger.ts        # Debug logger
    database/        # SQLite database + migrations
    ipc/             # IPC handlers by domain (tasks, timeEntries, comments, categories, reports)
    plugins/         # Plugin system (interface + implementations)
  renderer/          # React UI
    App.tsx          # Root component with HashRouter
    components/      # Layout, Sidebar, TaskList, TaskDetail, TimerBar,
                     # ReportView, DateRangePicker, SplitButton, OptionsMenu,
                     # TimeEntryEditor
    context/         # TaskContext, TimerContext
    utils/           # Helpers (time, duration, validation)
  shared/
    types.ts         # Shared TypeScript types
  test/              # Test infrastructure and mocks
```

## Roadmap

See [TODO.md](./TODO.md) for planned features and known work items.

## License

Private — not yet licensed for distribution.
