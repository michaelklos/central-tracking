# TODO

## Plugins

- [ ] **ADO plugin: implement API calls** — `testConnection`, `fetchTasks`, `pushComment`, `pushStatusUpdate`, `pushTimeUpdate`, and `sync` are all scaffolded but return stubs (`src/main/plugins/adoPlugin.ts`)
- [ ] **Jira plugin: implement API calls** — Same set of methods scaffolded but not yet functional (`src/main/plugins/jiraPlugin.ts`)
- [ ] **Plugin configuration UI** — No settings page yet for users to enter org URLs, PATs, etc.
- [ ] **Plugin sync reconciliation** — Merge logic for matching external tasks to local tasks by `externalId`

## Testing

- [x] **Set up test framework** — Vitest + @testing-library/react configured
- [x] **Unit tests for IPC handlers** — Task, time entry, comment, category CRUD
- [x] **Unit tests for database migrations** — Schema creation and idempotency
- [x] **Component tests for renderer** — TaskList, TaskDetail, TimerBar, Sidebar, ReportView, SplitButton, OptionsMenu
- [ ] **Integration tests** — End-to-end flows (create task, track time, export report)
- [ ] **Increase coverage** — Aim for >80% on critical paths

## UX / UI

- [x] **Drag-and-drop task reordering** — Implemented in TaskList
- [x] **Task lifecycle** — Complete/reactivate with auto timer stop/start
- [x] **Collapsible groups** — "Done" group collapsed by default
- [x] **Notes feature** — Notes tab, notes indicator, auto-save
- [x] **Manual time entries** — Create and edit completed entries
- [x] **Reporting** — Date range picker, bar chart, CSV export
- [x] **Split action button** — Add + Start / Add as To-Do
- [x] **Always-on-top pin** — Pin window toggle in timer bar
- [x] **Options menu** — Settings panel in sidebar
- [x] **Today's total** — Cumulative daily time in timer bar
- [ ] **Keyboard shortcuts** — Quick-start timer, create task, navigate list
- [ ] **Responsive layout improvements**
- [ ] **Notifications / reminders** — e.g., remind to stop timer after idle

## Data & Persistence

- [x] **Data export** — CSV export of time entries via Reports view
- [ ] **Data import** — Bulk import from external formats
- [ ] **Backup / restore** — Copy SQLite DB or export/import snapshots
- [ ] **Database migration tooling** — Currently a raw array of SQL strings; consider a more robust migration approach as schema evolves

## Build & Distribution

- [ ] **Electron Forge / electron-builder setup** — Package as installable app (.dmg, .exe, .AppImage)
- [ ] **Auto-update support**
- [ ] **Code signing**

## Developer Experience

- [ ] **Add `npm run dev:electron`** script — Single command to launch Electron with `NODE_ENV=development`
- [ ] **Pre-commit hooks** — Lint + type-check on commit (husky + lint-staged)
- [ ] **CI pipeline** — Lint, type-check, test on push
