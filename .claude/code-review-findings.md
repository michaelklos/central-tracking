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

- `src/renderer/components/TimeEntryEditor.tsx:88` — deps array uses ternaries
  (`[isCreate, isCreate ? props.defaultStartTime : null, ...]`). Defeats
  exhaustive-deps and creates surprising behavior when `isCreate` flips. Fix: split
  into separate Create vs Edit components (props are already a discriminated union).
  Deferred 2026-05-14: 22 tests would need to be retargeted; not worth the churn
  until we touch this file for another reason.

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
