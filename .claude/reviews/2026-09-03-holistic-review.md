# Holistic codebase review — 2026-09-03

> **Status (updated as work landed).** Tier 1 (1-4), tier 2 (5-8) and all of
> tier 3's correctness items are fixed.
> From tier 3: `batchUpdateTasks` FSM/state_dirty, `setExternalTaskState`
> clearing state_dirty, the category DELETE outside its transaction, migration
> atomicity, the `datetime('now')` timestamp format, and all four CLAUDE.md
> violations are fixed. Each fix was checked against the pre-fix code to
> confirm its tests actually fail there.
>
> Two corrections to this report, both found while implementing:
> - **Finding 5's suggested fix is wrong.** Pointing the renderer at
>   `dateRange.ts` would have made all four surfaces *consistently* wrong.
>   The helper itself emitted a UTC day (`T00:00:00.000Z`) from a local
>   calendar date; the skew was in the helper, not only in its callers.
> - **Finding 5 has a fifth surface** the report does not list: the CSV
>   export's Start/End columns, and `TimelineView`, which was already local
>   but a second short of midnight.
>
> Tier 3 correctness, second pass: the push-time running entry, the
> soft-delete filtering, the `linkTaskToPlugin` duplicate external id and the
> TimeEntryEditor overlap are fixed.
>
> **Tier 3 correctness is now closed.** Still open: all performance items, all
> simplification items, and the entire addendum.

Salvaged from an 8-agent review of `src/**` and `plugins/**` that ran out of
budget before its verification pass. Findings below are **finder candidates**,
not verified, except the four marked **CONFIRMED**, which were re-checked
against the source by hand.

Ranking below is by corroboration. Note that the finder prompts named some of
these patterns outright, so tier 2 is "flagged by several finders", not
"discovered independently". The findings rest on their quoted evidence, not on
the vote count.

---

## Tier 1 — confirmed by hand

### 1. A failed `timer start` kills the timer that was already running
`src/main/ipc/timeEntryHandlers.ts:66` — **CONFIRMED**

`createTimeEntry` stops the active entry, then inserts the new one. There is no
transaction and no task-id validation between the two. If the insert fails on
the foreign key (a prefix like `3f2a`, a mistyped or purged UUID), the user's
running timer has already been stopped and the request returns 500. The HTTP
layer only emits `ct:data-changed` on success, so the renderer keeps drawing a
timer that is no longer running.

Fix: resolve and validate the task id first, and wrap stop plus insert in one
`db.transaction`.

### 2. An ADO pull overwrites tasks that were linked, not mirrored
`src/main/ipc/taskHandlers.ts:608` and `plugins/ado/src/pull.ts:153` — **CONFIRMED**

`upsertExternalTask` finds its row by `(plugin_id, external_id)` with no check
on `source`, then unconditionally sets `title`, `notes` and `description`. But
`linkTaskToPlugin` documents `mode='link'` as "source stays whatever it was.
Title/notes remain user-editable ... does not pull state into ct."

So linking an ad-hoc task to work item 123 and then running a sprint pull
destroys the user's own title and notes. `refresh()` guards this correctly and
refuses on `source != 'plugin'`; `pull()` does not. `state_dirty` never
protects these tasks either, because `updateTask` only sets it for
`source='plugin'`.

Fix: skip the title/notes/description columns when the existing row is
link-only. Do **not** add `AND source = 'plugin'` to the lookup: the row then
misses, the `if (!existing)` INSERT branch runs, and it inserts a duplicate
`(plugin_id, external_id)` straight into the partial unique index from
migration 007. That turns a silent clobber into a hard failure on every pull.

### 3. An oversized request body hangs the CLI and leaks an unhandled rejection
`src/main/server/httpServer.ts:63` — **CONFIRMED**

`const bodyStr = await readBody(req)` sits outside the try/catch. On a body over
1MB, `readBody` destroys the request and rejects, so the rejection escapes the
async request listener. No 413 is ever written, the socket resets, and the CLI
reports a socket hang up. In the main process it surfaces as an unhandled
rejection.

Triggered by `ct import execute` on a markdown file over 1MB, which is an
ordinary thing to do.

Fix: wrap the await, and respond 413 before destroying.

### 4. Response bodies corrupt multi-byte UTF-8 at chunk boundaries
`src/main/server/httpServer.ts:28` and `src/cli/client.ts:116` — **CONFIRMED**

Neither side calls `setEncoding('utf8')`; the server does
`body += chunk.toString()` and the CLI does `body += chunk` on a Buffer. Any 2 to 4 byte character straddling a socket read
boundary decodes to U+FFFD. Nothing throws, so it corrupts silently. Reachable
with a few hundred tasks whose titles carry em-dashes, accents or emoji.

Fix: `req.setEncoding('utf8')`, or collect Buffers and `Buffer.concat` before
decoding once.

---

## Tier 2 — corroborated by multiple independent finders

### 5. UTC and local day boundaries disagree across every surface
Flagged by five finders.

- `src/renderer/components/ReportView.tsx:22` and `CategoryPieCharts.tsx:121`
  build `${date}T00:00:00Z` / `T23:59:59Z` from local calendar dates.
- `src/shared/dateRange.ts` emits `T23:59:59.999Z` and is what the CLI uses.
- `getTodayTotal` and task sorting query with `date(start_time, 'localtime')`.
- Summary reports group by UTC `date(start_time)`.

For a user west of UTC, an evening entry counts toward "Today" in the sidebar
but drops out of today's report, the pie charts, and the CSV export. The
renderer copy also loses the millisecond, so an entry started in the last
second of a day appears in `ct report` but not in the UI for the same range.

Fix: one decision about which day a timestamp belongs to, applied in one place.
`src/shared/dateRange.ts` already exists; the renderer should call it.

### 6. Task-id prefixes silently match nothing outside the task handlers
Flagged by two finders. `src/main/ipc/timeEntryHandlers.ts`,
`commentHandlers.ts`, `categoryHandlers.ts`.

Only the task handlers call `resolveTaskId`. The CLI advertises "UUID, prefix,
or name substring" for timer, time, comment, category and report commands. The
handlers use the raw string, so `ct task report 3f2a` updates zero rows and
prints "Marked 0 entries as reported" with exit 0, and `ct timer start standup`
throws a raw foreign-key error.

Fix: call `resolveTaskId` at every entry point that accepts a task id.

### 7. The "tracks reported" flag has three different precedence rules
Flagged by two finders. `PluginsSettings.tsx:47`,
`hooks/usePluginCapabilities.ts:39`, `plugins/ado/src/config.ts:46`.

The hook resolves config override, then manifest default, then true. The
settings page ignores the manifest. They agree today only because the ADO
manifest happens to set the value. A plugin declaring `tracksReported: false`
shows its toggle on while the task list hides the badges.

### 8. The ADO transition table is copied three times
Flagged by two finders. `taskHandlers.ts:13`, `renderer/utils/adoFsm.ts:12`,
`plugins/ado/src/push-state.ts:43`. Each carries a comment saying to change all
three together, which is the only thing keeping them in sync. Hoist one copy
into `src/shared`.

---

## Tier 3 — single-finder candidates, unverified

Correctness:
- `categoryHandlers.ts:71` — the DELETE runs outside the transaction, so one bad
  category id wipes every category off the task.
- `migrations.ts:201` — migrations run with no transaction and are not
  idempotent. A failure mid-migration leaves the DB half-migrated and every
  later launch re-throws, with nothing catching it in `main.ts`. The app would
  be permanently dead.
- `taskHandlers.ts:480` — `batchUpdateTasks` skips the FSM check and never sets
  `state_dirty`, so batch status changes on ADO tasks are never pushed and get
  reverted by the next pull.
- `taskHandlers.ts:694` — `setExternalTaskState` clears `state_dirty`
  unconditionally, dropping a status change made while a push was in flight.
- `taskHandlers.ts:460` — `deleted_at` written via `datetime('now')` while
  everything else is ISO. The renderer parses it as local time, so the recycle
  bin shows "deleted -1 days ago".
- ~~`taskHandlers.ts:741` — `linkTaskToPlugin` does not check whether another task
  already holds that external id, so the unique index throws a raw SQLite error
  surfaced verbatim to the user.~~ **Fixed.** Note there are *two* partial
  unique indexes on `external_id`, not one: `(plugin_id, external_id)` from
  migration 009 and `(source, external_id)` from 007. The pre-check mirrors
  both predicates exactly — including the fact that neither excludes
  soft-deleted rows, so a task in the recycle bin genuinely still collides and
  the message says so. Mirroring the predicates rather than guessing them is
  what keeps the check from rejecting links the index would have allowed.
- ~~`timeEntryHandlers.ts:201` — soft-delete is filtered inconsistently. The UI
  report excludes deleted tasks; `ct report`, the CSV export and the TimerBar
  total do not.~~ **Fixed, with one correction: `ct report` was never
  affected.** It calls `getSummaryReport`, which already filtered — the same
  handler the UI report uses. The three surfaces that actually leaked deleted
  tasks were `getTodayTotal` (TimerBar, `ct status`, `ct time`), which did not
  join `tasks` at all, the `timeEntries/getReport` route, and the CSV export.
  All three now filter, so every surface agrees with the recycle bin.
  A fourth, `getTimeEntriesByDateRange`, was missed on the first pass and
  fixed after: grepping for `deleted_at` finds the queries that *already*
  filter, not the ones with no join to `tasks` at all. It backs
  `TaskDetail`'s smart default start time, so a deleted task's entry could
  set the default. When auditing this class of bug, enumerate the queries
  that touch `time_entries`, not the ones that mention `deleted_at`.
- ~~`plugins/ado/src/push-time.ts:146` — push-time stamps the running entry as
  reported although its duration was never summed, so that time never reaches
  ADO.~~ **Fixed**, but in `timeEntryHandlers.ts`, not in the plugin: the
  finding located the symptom, not the cause. `markTaskEntriesReported` marked
  every unreported row including the running one, so the CLI and the UI's
  "mark reported" had the same hole. Both mark functions now require
  `end_time IS NOT NULL`; clearing is deliberately left unrestricted.

  Known consequence: a task with a running timer stays in
  `hasUnreportedTime`, so every `ado sync` while a timer runs picks it up,
  sums 0, and logs `push-time: #NNN rounded delta is 0 (0s, ...), skipping`.
  That is correct — the time genuinely is not final yet — but it is new
  recurring warning noise, not a regression.
- ~~`plugins/ado/src/pull.ts:114` — mirrored comments keep raw ADO HTML. The
  description goes through turndown; comments do not, and the renderer prints
  the body as text.~~ **Fixed.** Both callers of `mirrorComments` already had
  a turndown instance; it is now threaded through. A comment also carries a
  `format` of `markdown` or `html` — a detail the finding missed — so only the
  HTML ones are converted; turndown would escape and mangle a markdown one.
- ~~`plugins/ado/src/ado-client.ts:147` — comment pagination ignored, only the
  first page is mirrored.~~ **Fixed.** The response carries a
  `continuationToken` while pages remain; `getWorkItemComments` now follows it,
  under a page cap so a server that always returns a token cannot spin.
  Checked against the 7.1-preview.4 reference rather than inferred: the token
  is a `CommentList` body field (alongside `nextPage`), not a response header,
  and the query parameter is `continuationToken`.
- ~~`Sidebar.tsx:430` — "Reset filters" sets `{}` and drops `searchIn`, so search
  silently reverts to title-only while the dropdown still says "All".~~
  **Fixed.** Confirmed the mechanism: the effect that pushes `searchIn` into
  the filter is keyed on `searchMode`, so it fires only when the mode
  *changes* and never restores what the reset dropped. Reset now seeds
  `{ searchIn: searchMode }`. Leaving `searchIn` out of the button's
  visibility guard is correct — it is the dropdown's state, not a filter the
  reset should clear.
- ~~`TimeEntryEditor.tsx:145` — overlap validation misses a completed entry lying
  fully inside the new range.~~ **Fixed**, though only in the branch the line
  number points at. The *range* path delegates to `validateTimeEntry`, whose
  `startMs < eEndMs && endMs > eStartMs` is the standard interval test and
  already catches containment — no bug there. The bug is the **running-entry**
  branch, which tested only whether the new start instant landed inside another
  entry. A running entry occupies `start..now`, so backdating it over work
  already logged passed validation. That branch now does the same interval
  test against `now`.

CLAUDE.md violations, each against a rule the file states explicitly:
- `Sidebar.tsx:219` — `setImportPreview({...importPreview, ...})` in a handler.
- `preload.ts:49` — inline object types for `tasks.link` and
  `timeEntries.batchMarkReported`.
- `TimelineView.tsx:58` — awaited fetch with no staleness guard on `viewDate`.
- `taskHandlers.ts:240,247,249` — `resolveTaskId` throws plain `Error` where
  siblings throw `DomainError`. This is why `httpServer.ts:139` has to
  substring-match "not found" to pick a status code.

Performance:
- `taskHandlers.ts:45` — `rowToTask` runs four queries per task, so every list
  call is 4N+1. A 50-row page is roughly 200 SQLite round trips, repeated on
  every `ct:data-changed`.
- `plugins/_shared/src/ct-client.ts:131` — `getTasks` pulls every task and
  filters in JS, though the server supports `pluginId` and `hasUnreportedTime`
  as SQL. Each `ado sync` does this twice.
- `TaskList.tsx:72` — reads `elapsedSeconds` from TimerContext, so the whole
  list re-renders every second while a timer runs. Neither context memoizes its
  value object.
- `TaskContext.tsx:293` — every mutation refetches active, done, deleted and
  categories regardless of what changed.

Simplification:
- `TaskContext.tsx:319` — the refresh block is copy-pasted nine times and has
  already drifted at line 427, leaving the Done badge stale after a batch report.
- `taskHandlers.ts:278` — `getActiveTasks` and `getDoneTasks` are 30-line
  duplicates; the duration CASE expression appears in seven places in two
  variants, one counting the running entry and one not.
- `TaskDetail.tsx:351` — eight handlers hand-roll the same catch block, and
  three of them lack it entirely.
- `TaskList.tsx:91` — dead client-side filtering scaffolding left behind.

---

# Addendum — observed through use (2026-09-03)

Reported by the user from real use, not by the review agents. I checked each
against the source; notes below say what is grounded and what is a design call.

## Bugs

### A1. Any refresh collapses the list back to 50, discarding "load more"
`src/renderer/context/TaskContext.tsx:183` and `:191` — **grounded**

`loadMoreActiveTasks` appends with `offset: activeTasks.length`, but
`refreshActiveTasks` always refetches `offset: 0, limit: ACTIVE_TASKS_LIMIT`.
Every mutation and every `ct:data-changed` event calls the refresh, so it
throws away everything paged in. Adding a tag past the visible set snaps the
list back to the first 50, which is exactly the reported symptom.

This is the same mechanism as the tier-3 finding that `TaskContext` refetches
everything on every mutation. Fix both together: the refresh should refetch
`limit: max(ACTIVE_TASKS_LIMIT, activeTasks.length)` so it restores what was
loaded rather than the first page.

### A2. Timeline gap click creates a hidden blank to-do past 50 tasks
**grounded, same root cause as A1**

With more than 50 tasks loaded, the new task falls outside the refetched first
page, so the UI cannot select what it just created. The task does exist in the
database; it is invisible, not missing. Fixing A1 likely fixes this, but the
create-then-select path should also select by returned id rather than by
searching the loaded list.

### A3. Creating a task leaves the previously running task selected
The new task's id is returned by `tasks:create` but never promoted to the
selection. Related to A2: both are the create path failing to select its own
result. Worth fixing in one change.

### A4. Starting a timer on a to-do does not move it to in progress
Design call, with one constraint. For ADO mirror tasks the change has to go
through `updateTask` so the FSM check runs and `state_dirty = 1` is set,
otherwise the status never pushes and the next pull reverts it. Do not write
the status directly from the timer handler. Confirm `todo → in-progress` is a
legal transition in all three copies of the table, per tier-2 finding 8.

### A5. Batch mode exits automatically after Apply
The selection dialog closes on apply, so applying a second change means
reselecting everything. Should stay open with the selection intact.

### A6. Batch mode applies only one category at a time
`assignCategoriesToTask` already takes `categoryIds: string[]`, so the backend
supports this today. The gap is renderer-only.

Note: fixing this makes the tier-3 category bug worse in practice.
`categoryHandlers.ts:71` runs its DELETE outside the transaction, so one bad id
in a multi-category apply wipes every category off the task. Fix that first.

## Missing UI over existing backend

### A7. Categories cannot be renamed
`src/main/ipc/categoryHandlers.ts:43`, `apiManifest.ts:109`,
`TaskContext.tsx:358` — **grounded**

`updateCategory` is fully wired from the database up to the renderer context,
and `UpdateCategoryInput` carries the name. The only consumer is
`OptionsMenu.tsx:230`, which binds it to the color picker alone. Renaming needs
a text input next to that color input calling the same function. No backend,
IPC, or CLI work.

### A8. Page size is hardcoded
`TaskContext.tsx:4-6` — **grounded**

`ACTIVE_TASKS_LIMIT`, `DONE_TASKS_LIMIT` and `DELETED_TASKS_LIMIT` are module
constants set to 50. Making this a setting means threading a value from
persisted settings into those three call sites. The main-process handlers
already accept an arbitrary `limit`.

## Feature requests

### A9. To-Do section always visible, remembering collapsed state
Two parts. Pin the group so it renders even when empty, and persist the
expanded flag. Other UI state is already persisted to localStorage, so follow
that pattern.

### A10. Right-click context menu for common task actions
Delete, categorize, set status. The actions all exist on `TaskContext`; this is
a presentation layer over them.

### A11. Link task effort to a local repository and specific commits
The largest item, and the only one needing schema work. Sketch:

- A new migration for the link. Storing the repo path on the category is the
  weaker option, because effort is per task and one category can span repos. A
  nullable `repo_path` on tasks, plus a `task_commits` table keyed by task id
  with commit SHA, subject and timestamp, keeps commits attached to the effort
  they belong to.
- Whether a commit ties to a task or to an individual time entry is the real
  design question. Time entries are what carry the effort, so commits may want
  to hang off `time_entries` instead. Decide that before writing the migration.
- The plugin webhook system is a plausible home for the git reading, which
  keeps `child_process` calls out of the main process and reuses the existing
  enable/disable and config machinery.
