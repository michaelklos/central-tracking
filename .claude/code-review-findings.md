# Code-review findings (Central Tracking)

## For a fresh agent picking this up

If you've just been pointed at this file with no other context, here's how to orient:

- **Project is at `/Users/mklos/repos/central-tracking`.** Read `CLAUDE.md` at the
  project root first — it has the architecture overview, the build/test commands, and
  the IPC + HTTP API surface.
- This document is a punch list from an audit performed on 2026-05-14. The CRITICAL
  items were fixed in that session. Everything under HIGH / MEDIUM / LOW remains open,
  plus the items added afterwards (newest at the bottom of each section).
- Each item is `file:lines — problem. Fix: …`. Open the file, read the surrounding
  code, then apply the suggested fix (or push back if the suggestion doesn't fit).
- **Always use TodoWrite** to track which items you're tackling in a session, and
  mark items completed only after `npm test` passes and `npm run build:main` +
  `npm run build:renderer` are clean.
- **Three recurring footgun families** caused the calibration bugs and most of the
  open items. Before adding new code anywhere, check whether you're falling into one
  of these:

  1. **Field-name drift through narrow inline IPC types.** `src/main/preload.ts` has
     per-method param types that are NARROWER than the renderer-side
     `CentralTrackingAPI` declarations. When the renderer passes extra fields they
     flow over IPC just fine (structured cloning preserves them), but TypeScript loses
     the chance to catch typos. The original calibration bug: `loadMoreDoneTasks`
     passing `filter.status`, `filter.source`, `filter.categoryId` (singular) when
     the actual fields are plural — silently dropped the filter on pagination.
  2. **`setX({...x, ...})` inside an effect or handler.** Captures the closure value
     of `x`, which goes stale the moment two updates land within the same tick or
     before a debounce drains. The original calibration bug: Sidebar's 200ms search
     debounce overwriting a concurrent category-filter change. Always use
     `setX(prev => ({...prev, ...}))` when the update depends on previous state.
  3. **`await ipc(id); setState(result)` with no staleness guard.** If the user
     changes selection during the await, `result` is for the old selection but
     overwrites the new one's state. The original calibration bug: TaskDetail's
     post-early-return hooks caused a React #300 crash when the selected task got
     filtered out (a related but more severe shape of the same async-mid-flight
     hazard). Always capture the id locally and bail before setState if it changed.

- The first three calibration bugs are documented under CRITICAL — fixed. Read those
  examples first before opening other items; they're the depth of review expected.

- Suggested workflow for a session: pick a coherent batch (e.g., HIGH 1–3 are all
  preload typing; HIGH 4 + 12 are the same stale-closure pattern; HIGH 7 + 8 are
  security). One commit per batch. Run tests after each batch.

- When you finish items, **remove them from this file** (don't just check them off
  — keep the doc as a list of OPEN items). If you discover new issues during a
  session, append them at the end of the relevant severity tier so future agents see
  them.

## Footgun families — quick reference

| Family | Where it lives | Calibration example | Fix pattern |
|---|---|---|---|
| Field-name drift | `preload.ts` inline types, IPC boundary | TaskContext singular vs plural | Use shared/types interfaces in preload |
| Stale closure on `setX({...x})` | Effects, event handlers | Sidebar 200ms debounce overwriting category change | `setX(prev => ({...prev, ...}))` |
| Async stale setState | After `await` in load functions | TaskDetail post-return hooks crash (related shape) | Capture id, ref-check before setState |

## CRITICAL — fixed 2026-05-14

Listed here for reference, since the fixes are non-obvious and may need to be
revisited:

- `src/main/server/httpServer.ts:88-90` — `JSON.parse(body)` then
  `route.handler(db, ...args)` with no array check. Fix applied: `Array.isArray(args)`
  guard returning 400 on bad body.
- `src/renderer/components/TaskDetail.tsx:56-90` — `loadTimeEntries`/`loadComments`/
  `loadSmartDefaults` had no staleness check, so a rapid task switch could overwrite
  the new task's state with the old task's data. Fix applied: `currentTaskIdRef` is
  set to the latest `selectedTaskId` each render; loaders capture `taskId` at entry
  and bail before `setState` if `currentTaskIdRef.current !== taskId`.
- `src/renderer/components/Sidebar.tsx:73-78, 105-110` (pre-fix locations) —
  `useReportContext`, `useNavigate`, `useLocation` wrapped in try/catch. React error
  #300 risk. Fix applied: removed try/catch; Sidebar.test.tsx now mocks
  `react-router-dom` and `../../context/ReportContext`.
- `src/main/ipc/timeEntryHandlers.ts:165`, `taskHandlers.ts:44, 81` — `date(start_time)
  = date('now')` used SQLite's UTC date, causing "today's timer" to overcount during
  morning hours west of UTC (last evening's entries had UTC date matching today's UTC
  date until 5pm local). Fix applied: added `'localtime'` modifier on both sides of
  every "is this entry today?" comparison.

## HIGH — open

(none — all items closed 2026-05-14)

## MEDIUM — open

- `src/main/server/httpServer.ts:67, 120-135` — `isValidHost` reads `actualPort` via
  closure; works because listen runs before any requests, but fragile if init order
  ever changes. Fix: capture port via a getter or move `createServer()` after the
  listen loop.
- `src/renderer/context/TaskContext.tsx:229-262` — data-changed listener effect
  re-binds on every keystroke (filter.search changes → `refreshActiveTasks` identity
  changes → effect re-runs → re-subscribes to `onDataChanged`). Resets the 100ms
  debounce too. Fix: stash `refreshActiveTasks` in a ref; depend on stable
  identities only.
- `src/renderer/components/TimelineView.tsx:76-83` — `isViewingToday` true→false
  transition leaves the previous "today" interval running until the next deps change
  (the false branch returns undefined from the effect). Fix: always return a cleanup
  from the effect.
- `src/renderer/components/TimelineView.tsx:164` and `CategoryPieCharts.tsx:209, 259,
  272` — `key={index}`/`key={i}` on lists whose order changes; React reconciliation
  can attach the wrong DOM nodes. Fix: use stable derived keys (e.g.,
  `${item.type}:${item.startTime.toISOString()}`).
- `src/renderer/components/TimeEntryEditor.tsx:88` — deps array uses ternaries
  (`[isCreate, isCreate ? props.defaultStartTime : null, ...]`). Defeats
  exhaustive-deps and creates surprising behavior when `isCreate` flips. Fix: split
  into separate Create vs Edit components (props are already a discriminated union).
- `src/renderer/components/OptionsMenu.tsx:68-71` — empty deps `[]` with `isMac`
  referenced inside. Works only because `isMac` is constant. Fix: add to deps.
- `src/main/server/apiManifest.ts` — `tasks:resetApp` and `tasks:getActiveIds` exist
  as IPC channels but have no HTTP route entries; CLI can't reach them. There's a
  parity test (`apiManifest.parity.test.ts`) — likely missing assertion. Fix: add
  routes or document the IPC-only exemption.
- `src/main/import/importExecutor.ts:115-117` — `ImportResult` reports `created` and
  `skipped` but no `updated`; dedup'd duplicates count as "created" but are silently
  merged. Fix: extend `ImportResult` with `updated`; document dedup behavior.
- `src/renderer/components/HelpPopover.tsx:47` — `window.addEventListener('scroll',
  () => setOpen(false), { once: true })` added without matching `removeEventListener`;
  cleanup only removes 'mousedown'. Inline closure stays registered until scroll
  fires. Fix: capture the function in a const and remove it in cleanup.
- `src/renderer/components/DateRangePicker.tsx:~11` + `src/renderer/context/ReportContext.tsx:4-5`
  — `toDateString(new Date())` uses `.toISOString().split('T')[0]`, which is
  UTC-relative. Users in UTC-7 see "yesterday" until 5 PM local. The "today's timer
  overcounting" fix landed in the SQL layer, but this same UTC-vs-local issue lives
  in the renderer for date pickers and the default report range. Fix: format with
  local components (`getFullYear`/`getMonth`/`getDate`) — `TimelineView` already has
  the right helper, reuse it.
- `src/main/ipc/taskHandlers.ts:130-149` — `resolveTaskId` LIKE-matches user input
  concatenated into `%${id}%`; `%`/`_` in the input aren't escaped. CLI lookup like
  `ct task delete "100%"` matches every task containing "100". Fix: escape LIKE
  metacharacters (e.g., wrap with `ESCAPE '\'` and replace `%`, `_`, `\` in input),
  or attempt an exact-match before fuzzy.
- `src/renderer/components/Sidebar.tsx:122-125` — `searchMode` init effect fires
  `setFilter` on first mount even when nothing has changed (filter.searchIn
  undefined → set to 'title'). Extra refresh on every Sidebar mount. Fix: seed the
  default into the initial `TaskContext` filter state instead.
- `src/renderer/context/TaskContext.tsx:137` — `tasks = useMemo(() => [...activeTasks,
  ...doneTasks], ...)` is fine, but if the active timer is on a task that's been
  filtered out of `activeTasks` AND not in `doneTasks`, the TimerBar reads "Unknown
  task". Fix: have TimerContext separately fetch the active task by id (don't rely
  on the filtered list).
- `src/main/main.ts:73` — `preferences.json` parsed via `JSON.parse` inside try/catch
  (good); a malformed-but-readable file silently disables the feature. Fix: log a
  warning so users notice corrupt prefs. **Careful**: keep the warning generic — the
  surrounding feature is deliberately low-profile (see `localdocs/` if it exists in
  the repo; that dir is gitignored).
- `src/renderer/components/TaskDetail.tsx:188-191, 244-247` — `handleComplete`/
  `handleTimerToggle` catch errors with `console.error` only; failed DB writes leave
  the UI thinking the operation succeeded. Fix: surface error via toast/inline
  message and roll back optimistic state if any.

## LOW — open

- `src/main/server/auth.ts:23` — `writeFileSync` mode 0o600 only applied on file
  creation; existing file keeps its perms. Fix: `fs.chmod` after write.
- `src/main/ipc/cliHandlers.ts:23` — `buildWrapperScript` embeds `process.execPath`
  in a double-quoted shell string without escaping. Won't matter for typical Electron
  paths; breaks if path contains `$` or `"`. Fix: single-quote with escaping, or
  ship a launcher binary.
- `src/renderer/hooks/useIntersectionObserver.ts:19` — depends on `options?.threshold`
  by reference; a fresh array each render tears down and rebuilds the observer. Fix:
  deep-compare or require callers to memoize.
- `src/renderer/components/ErrorBoundary.tsx:31` — "Try again" sets error to null but
  doesn't reset child state; same error fires again → loop. Acceptable in prod;
  worth a comment.
- `src/main/main.ts:130-132` — `mainWindow!.webContents.once(...)` non-null
  assertion after `createWindow`; if `createWindow` throws (e.g., headless CI) the
  next line dereferences null. Fix: guard with `if (mainWindow)`.
- `src/test/mocks/database.ts:9-13` — `:memory:` Database passes `journal_mode = WAL`
  pragma, meaningless for in-memory. Misleading. Fix: skip WAL pragma when path is
  `:memory:` in the Database constructor.
- `src/renderer/components/CategoryPieCharts.tsx:64` — divides shared time evenly
  across a task's categories; mathematically arbitrary and the UI doesn't explain
  it. Fix: document or expose a "primary category only" toggle.

---

**When closing this doc out**: when every item here is fixed or explicitly deferred,
delete this file and remove the link from `CLAUDE.md`. Don't let it linger as a
graveyard of "won't fix" items — those belong in code comments at the relevant
sites.
