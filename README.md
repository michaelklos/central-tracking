# Central Tracking

A desktop task and time tracking application built with Electron, React, and TypeScript. Designed as a personal productivity hub that consolidates tasks from multiple sources — ad-hoc items, email follow-ups, meeting prep — alongside a plugin system for syncing with external tools like Azure DevOps and Jira.

## Features

- **Task management** — Create, edit, reorder, and organize tasks with statuses (todo, in-progress, done, blocked) and sources (ad-hoc, email, meeting-prep, plugin)
- **Time tracking** — Start/stop timer per task, view elapsed time, track daily and total time per task
- **Categories & labels** — Color-coded categories that can be assigned to tasks for filtering
- **Comments** — Add notes to tasks, with optional sync-to-external-system flag
- **Filtering** — Search tasks by text, filter by status, source, or category
- **Plugin architecture** — Extensible system for integrating with external task/ticket systems (ADO and Jira scaffolds included)
- **Local-first** — All data stored in a local SQLite database; no account or cloud service required

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 31 |
| Frontend | React 18, TypeScript 5.5 |
| Bundler | Webpack 5 (with webpack-dev-server for HMR) |
| Database | SQLite via better-sqlite3 |
| State management | React Context |
| Routing | react-router-dom v6 |
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

### Lint

```bash
npm run lint
```

## Project Structure

```
src/
  main/              # Electron main process
    main.ts          # App bootstrap, window creation
    preload.ts       # Context bridge API
    database/        # SQLite database + migrations
    ipc/             # IPC handlers by domain
    plugins/         # Plugin system (interface + implementations)
  renderer/          # React UI
    App.tsx           # Root component
    components/      # Layout, Sidebar, TaskList, TaskDetail, TimerBar
    context/         # TaskContext, TimerContext
    utils/           # Helper functions
  shared/
    types.ts         # Shared TypeScript types
```

## Roadmap

See [TODO.md](./TODO.md) for planned features and known work items.

## License

Private — not yet licensed for distribution.
