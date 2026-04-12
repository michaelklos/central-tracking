# Central Tracking

A desktop task and time tracking application built with Electron, React, and TypeScript. Designed as a personal productivity hub that consolidates tasks from multiple sources — ad-hoc items, email follow-ups, meeting prep — with a CLI (`ct`) for programmatic access by AI agents and scripts.

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
- **CLI (`ct`)** — Full-featured command-line interface for all operations; changes appear in the UI in real-time. Supports `--json` for machine-readable output.
- **Agent-friendly** — External integrations (ADO, Jira, custom scripts) use CLI commands rather than in-process plugins
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

### CLI

Build and link the CLI:

```bash
npm run build:cli     # Compile CLI to dist/cli/
npm link              # Makes `ct` available globally
```

Or run directly:

```bash
node dist/cli/cli/main.js --help
```

The CLI requires the Electron app to be running. It discovers the server via `{userData}/ct-server.json`.

```bash
ct status                           # Check if app is running
ct task list                        # List active tasks
ct task create "New task"           # Create a task (appears in UI)
ct timer start <task-id>            # Start timer (UI updates)
ct timer stop                       # Stop timer
ct report summary --from 2026-04-01 --to 2026-04-11  # Text report
ct report export --from 2026-04-01 --to 2026-04-11 --out report.csv
ct task list --json                 # Machine-readable output
```

See `ct --help` or `ct <command> --help` for full usage.

### Debug Mode

```bash
npm run start:debug
```

### Packaging

Builds unsigned distributable(s) locally:

```bash
npm run dist        # both platforms (only works on the current OS)
npm run dist:mac    # macOS: .dmg + .zip (x64 and arm64)
npm run dist:win    # Windows: NSIS installer (x64)
```

Output goes to `release/`. Unsigned builds run fine for local testing; macOS will show a Gatekeeper warning and Windows may show a SmartScreen prompt.

## Releases

Releases are built by GitHub Actions (`.github/workflows/release.yml`). Push a version tag to trigger a build on both platforms, sign/notarize the artifacts, and publish a GitHub Release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow produces signed artifacts only when the signing secrets are configured (see below). Without them it builds and uploads unsigned artifacts.

### Code Signing Setup

#### macOS

**Prerequisites:** Apple Developer Program membership ($99/yr).

**Steps:**

1. In Xcode → Settings → Accounts, add your Apple ID and generate a **Developer ID Application** certificate (used for distribution outside the App Store). This adds it to your Keychain automatically.

2. In Keychain Access, find the **Developer ID Application: Your Name (XXXXXXXXXX)** certificate, right-click → Export → save as a `.p12` with a strong password.

3. Base64-encode the `.p12`:
   ```bash
   base64 -i certificate.p12 | pbcopy   # macOS — copies to clipboard
   ```

4. Generate an **app-specific password** for notarization at [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords.

5. Find your **Team ID** at [developer.apple.com/account](https://developer.apple.com/account) → Membership.

6. Add the following secrets to your GitHub repo (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `APPLE_CSC_LINK` | base64-encoded `.p12` from step 3 |
   | `APPLE_CSC_KEY_PASSWORD` | `.p12` export password from step 2 |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from step 4 |
   | `APPLE_TEAM_ID` | 10-character Team ID from step 5 |

#### Windows

**Prerequisites:** A code-signing certificate from a trusted CA (DigiCert, Sectigo, GlobalSign, etc.).

- **OV (Organization Validation)** — ~$100–300/yr. Requires proving your business exists. Removes most SmartScreen warnings once you accumulate reputation.
- **EV (Extended Validation)** — ~$300–500/yr. Comes on a USB hardware token. SmartScreen reputation is immediate, but EV tokens can't be used directly in CI — you'd need a cloud signing service (e.g. DigiCert KeyLocker, SSL.com eSigner) and a custom signing setup.

For standard CI use, an OV certificate is the practical choice.

**Steps:**

1. Purchase an OV certificate. The CA will verify your identity/organization and deliver a `.pfx` file.

2. Base64-encode the `.pfx`:
   ```bash
   # macOS/Linux
   base64 -i certificate.pfx | pbcopy
   # Windows (PowerShell)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | clip
   ```

3. Add the following secrets to your GitHub repo:

   | Secret | Value |
   |---|---|
   | `WIN_CSC_LINK` | base64-encoded `.pfx` from step 2 |
   | `WIN_CSC_KEY_PASSWORD` | `.pfx` password |

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
    main.ts          # App bootstrap, window creation, HTTP server startup
    preload.ts       # Context bridge API
    logger.ts        # Debug logger
    database/        # SQLite database + migrations
    ipc/             # IPC handlers by domain (tasks, timeEntries, comments, categories, reports)
    server/          # Local HTTP server for CLI communication
    reports/         # Pure report generation (CSV)
    import/          # Import parsing and execution
  cli/               # CLI tool (`ct`)
    main.ts          # Entry point, yargs command tree
    client.ts        # Server discovery and HTTP client
    formatters.ts    # Human-readable output formatting
    commands/        # Command modules (task, timer, time, report, comment, category, import, status)
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
