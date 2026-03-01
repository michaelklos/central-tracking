# TODO

## Plugins

- [ ] **ADO plugin: implement API calls** — `testConnection`, `fetchTasks`, `pushComment`, `pushStatusUpdate`, `pushTimeUpdate`, and `sync` are all scaffolded but return stubs (`src/main/plugins/adoPlugin.ts`)
- [ ] **Jira plugin: implement API calls** — Same set of methods scaffolded but not yet functional (`src/main/plugins/jiraPlugin.ts`)
- [ ] **Plugin configuration UI** — No settings page yet for users to enter org URLs, PATs, etc.
- [ ] **Plugin sync reconciliation** — Merge logic for matching external tasks to local tasks by `externalId`

## Testing

- [ ] **Set up test framework** — No test runner configured (consider Vitest or Jest + React Testing Library)
- [ ] **Unit tests for IPC handlers** — Task, time entry, comment, category CRUD
- [ ] **Unit tests for database migrations** — Ensure schema is created correctly
- [ ] **Component tests for renderer** — TaskList, TaskDetail, TimerBar, Sidebar

## UX / UI

- [ ] **Drag-and-drop task reordering** — `reorder` API exists but no drag UI
- [ ] **Keyboard shortcuts** — Quick-start timer, create task, navigate list
- [ ] **Dark mode / theming**
- [ ] **Responsive layout improvements**
- [ ] **Task detail: time entry history view** — Show past time entries per task
- [ ] **Notifications / reminders** — e.g., remind to stop timer after idle

## Data & Persistence

- [ ] **Data export** — Export tasks / time entries to CSV or JSON
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
