# ADO Plugin — Implementation Plan

> **For the assistant reading this with fresh context:** This file is the source of truth for the ADO plugin work. Read it end-to-end before doing anything. The "Handoff Status" section at the top tracks where we are. After completing a stage, update Handoff Status and prompt the user to `/clear` before the next stage.

---

## Handoff Status

**Current stage:** Stage 0 — done; ready for Stage 1
**Last updated:** 2026-05-18
**Last commit on this work:** b82da3a (Scaffold ADO plugin (Stage 0): schema, handlers, skeleton)
**Open questions blocking progress:** none
**Notes from prior session:**
- Plan locked after 4 rounds of clarification. Scope is firm — do not re-debate ownership/conflict rules.
- **Stage 0 findings (read before Stage 1):**
  - **Status name mismatch.** Plan's state-map example uses `to-do`/`completed`, but the codebase's actual `TASK_STATUSES` is `['todo','in-progress','done','blocked']`. Stage 1's state-map config must use the real ct status names (`todo`, `in-progress`, `done`) — DO NOT rename ct statuses to match the plan; update the state-map keys instead.
  - **`'ado'` added to `TASK_SOURCES`** in `src/shared/types.ts`. Source-of-truth value, used by handlers and filters.
  - **`ct plugin run <id>` now forwards extra positional args** (`src/cli/commands/plugin.ts`). Required so `ct plugin run ado pull` passes `pull` through to the plugin's yargs parser.
  - **Plugin compiles standalone with local types** (`plugins/ado/src/types.ts`) instead of importing from `src/shared/types.ts`. Reason: tsc `rootDir` constraint when building the plugin workspace in isolation. Stage 1+ should add new fields to the local file when needed and let drift be caught at the API boundary, not at compile time.
  - **Stray `src/shared/types.js`** can appear if `npm install` triggers a workspace build before the plugin's tsconfig is set up correctly. Safe to delete; not part of the build output.
  - **Migration 002 test required updating** to seed the `comments` table in its partial-schema fixture — migration 007 ALTERs comments, which the original fixture didn't create.
  - **Lint baseline pre-existing:** 3 errors + 3 warnings (`@typescript-eslint/no-require-imports` rule missing, plus 3 `no-console` warnings). Same on `main` before any Stage 0 work. Not introduced by this stage.
  - **CLI `api.ts` parity is test-enforced.** `src/main/server/__tests__/apiManifest.parity.test.ts` fails if any HTTP route lacks a typed method in `src/cli/api.ts`. Every Stage 1+ route addition must update BOTH `src/main/server/apiManifest.ts` AND `src/cli/api.ts` (interface + impl). Easy to forget — the test catches it.
  - **Native module env quirk (Node v26).** `npm test` pretest hook (`scripts/ensure-node-sqlite.js`) fails because no prebuilt `better-sqlite3` binary exists for Node 26. Workaround: run `npx node-gyp rebuild --directory=node_modules/better-sqlite3` once after `npm install`, then invoke `npx vitest run` directly instead of `npm test`. Pre-existing toolchain issue, not plan-related.
  - **Plugin `entrypoint` is repo-root-relative.** `plugins/ado/plugin.json` declares `entrypoint: "node plugins/ado/dist/index.js"`. `ct plugin run ado ...` spawns this from the CLI's CWD, so it only works when `ct` is invoked from the repo root. Two fixes possible: (a) resolve entrypoint relative to manifest path inside `plugin run`, or (b) document "run from repo root only." Defer to Stage 1 — choose one and apply.

### Stage checklist

- [x] **Stage 0** — Scaffolding (schema migration 007, plugin skeleton, types, config)
- [ ] **Stage 1** — Pull + display (read-only ADO mirror in ct)
- [ ] **Stage 2** — Time push (CompletedWork sync via existing reportedAt machinery)
- [ ] **Stage 3** — Comments push + state push (full bidi additive)

### Assistant instructions for handoff maintenance

1. **Before starting a stage:** read entire plan, confirm exit criteria of prior stage met, check git log for any drift.
2. **During work:** keep ad-hoc notes in this file under "Notes from prior session" if discovering anything non-obvious (e.g. ADO API quirks, unexpected schema requirements).
3. **On stage completion:**
   - Tick the checkbox.
   - Update `Last commit on this work` with the final SHA of the stage.
   - Update `Last updated` to today's date.
   - Append any non-obvious findings to "Notes from prior session".
   - **Then prompt the user:** "Stage N complete. Recommend `/clear` before Stage N+1 — plan has been updated. Ready?"
   - Do NOT auto-proceed to next stage.

---

## Goals & Non-Goals

**Goals:**
- Auth to Azure DevOps via PAT (stored in `plugin_config`).
- Pull current sprint work items into ct as tasks (read-only mirror).
- Push time logged in ct → ADO `CompletedWork` (additive).
- Push new comments in ct → ADO work item comments (additive).
- Push state changes in ct → ADO state (FSM-bounded, additive nudge).
- Display ADO link + ADO-side hours total in ct UI.
- Never require user to open ADO for routine work.

**Non-goals (v1):**
- Editing or deleting prior pushes (time entries, comments). Those operations stay in ADO.
- Pulling ADO worklog entries (only the running total via `CompletedWork`).
- Bidirectional title/description sync (ADO owns; ct displays read-only).
- Workflow-rule simulation in ct. ADO rejects → log, surface to user.
- Periodic auto-sync. User runs `ct plugin run ado sync` (or via cron/launchd).
- Drift detection between ct-pushed time and ADO total.

---

## Ownership Matrix (LOCKED — do not re-debate)

| Field / op | Owner | Push (ct→ADO)? | Pull (ADO→ct)? | Conflict resolution |
|---|---|---|---|---|
| state/status | ADO (final) | yes (additive nudge, FSM-bounded) | yes | ADO wins; `state_dirty=0` after successful push so next pull is silent if ADO confirms; ADO change reverts ct on next pull if not dirty |
| time / CompletedWork | shared additive | yes (delta of unreported entries, rounded) | display only via `external_completed_hours` | no conflict — increments |
| comments | shared additive | yes (new only, no PATCH back) | yes (mirror read-only) | append-only, dedup by `external_id` |
| title | ADO | no | yes (overwrite) | ct title is read-only when `source='ado'` |
| description / notes | ADO | no | yes (html→md → `notes`) | ct notes is read-only when `source='ado'` |
| local scratch | ct | no | no | future addition if needed (deferred) |

**Sync ordering per run:** push → pull. Push happens first so a fresh ct push doesn't get clobbered by stale pull data within the same run. After successful push, `external_state` is updated to the pushed value, so the immediate pull sees no diff and leaves ct alone.

---

## Schema — Migration 007

> **Migration 006 already exists** (`reported_at` column on `time_entries`). New work is migration **007**.

```sql
-- Migration 007: ADO plugin support
ALTER TABLE comments ADD COLUMN external_id TEXT;
ALTER TABLE tasks ADD COLUMN external_url TEXT;
ALTER TABLE tasks ADD COLUMN external_state TEXT;
ALTER TABLE tasks ADD COLUMN external_completed_hours REAL;
ALTER TABLE tasks ADD COLUMN external_refreshed_at TEXT;
ALTER TABLE tasks ADD COLUMN state_dirty INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_tasks_source_external
  ON tasks(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_comments_external_id
  ON comments(external_id) WHERE external_id IS NOT NULL;
INSERT OR IGNORE INTO schema_version (version) VALUES (7);
```

Append to `MIGRATIONS` array in `src/main/database/migrations.ts`. Existing migration pattern uses one template-literal string per version with trailing `INSERT OR IGNORE INTO schema_version`.

---

## Plugin config keys (plugin_config table)

```
ct plugin config set ado pat              <token>
ct plugin config set ado organization     <org-slug>          # e.g. "contoso"
ct plugin config set ado project          <project-name>
ct plugin config set ado team             <team-name>          # for current iteration query
ct plugin config set ado round-minutes    15                   # default 15
ct plugin config set ado round-mode       nearest              # nearest|up|down, default nearest
ct plugin config set ado state-map        <json>               # see below
ct plugin config set ado work-item-types  "User Story,Bug,Task"   # pull filter
ct plugin config set ado pull-closed      false                # include closed items?
ct plugin config set ado auto-comment-on-time-push  false      # build worklog comment from time-entry notes
```

**state-map JSON shape:**

```json
{
  "to-do":       { "ado": "New",    "altIn": ["New"] },
  "in-progress": { "ado": "Active", "altIn": ["Active", "Committed"] },
  "completed":   { "ado": "Closed", "altIn": ["Closed", "Resolved", "Done"] }
}
```

- `ado` = ADO state ct pushes when ct status changes to this key.
- `altIn` = ADO states that map back to this ct status on pull.

---

## FSM (status transitions on ado-source tasks)

Allowed transitions:
- `to-do → in-progress`
- `to-do → completed`
- `in-progress → completed`
- `completed → in-progress` (reopen — warn user "ADO may reject; will revert from ADO on next pull if so")

Enforce in renderer (TaskDetail status dropdown filters options) AND in backend update handler (defense in depth). Backend rejection: HTTP 400 + machine-readable error code.

---

## File structure

```
plugins/
  ado/
    PLAN.md                        ← this file
    plugin.json                    ← plugin manifest
    package.json                   ← separate npm workspace, deps: axios, turndown, marked
    tsconfig.json
    src/
      index.ts                     ← yargs entrypoint: pull, push, sync, refresh <id>
      ado-client.ts                ← ADO REST wrapper (PAT auth, retry, ETag)
      ct-client.ts                 ← HTTP client to ct (CT_SERVER_URL / CT_TOKEN env)
      config.ts                    ← config loader (reads plugin_config via ct API)
      state-map.ts                 ← status↔state mapping + FSM
      pull.ts                      ← stage 1
      push-time.ts                 ← stage 2
      push-comments.ts             ← stage 3
      push-state.ts                ← stage 3
      sync.ts                      ← orchestrator (push → pull)
      types.ts                     ← ADO API response shapes
      __tests__/                   ← mocked ADO REST via msw or nock
```

---

## Shared types updates (`src/shared/types.ts`)

Add to `Task` interface:
```ts
externalUrl: string | null;
externalState: string | null;
externalCompletedHours: number | null;
externalRefreshedAt: string | null;
stateDirty: boolean;   // surfaced read-only to renderer
```

Add to `Comment` interface:
```ts
externalId: string | null;
```

Update SQLite row mappers in `taskHandlers.ts` and `commentHandlers.ts` accordingly (snake_case → camelCase).

---

## IPC / HTTP API additions

| Channel | Purpose | Mutates |
|---|---|---|
| `tasks:upsertExternal` | Upsert task by `(source, external_id)`. Used by plugin pull. Sets `external_url`, `external_state`, `external_completed_hours`, `external_refreshed_at`. Triggers `state_dirty` reset if ADO state matches new external_state. | yes |
| `comments:upsertExternal` | Upsert comment by `external_id`. Used by plugin to mirror ADO comments. Sets `synced=true`, `syncable=false`, `external_id`. | yes |
| `tasks:setExternalState` | Set `external_state` + clear `state_dirty` after successful push. | yes |

Register handlers in `src/main/ipc/{taskHandlers,commentHandlers}.ts` and add HTTP routes in `src/main/server/httpServer.ts` route table.

**`state_dirty` auto-flip:** modify task update handler — if `source='ado'` and incoming update changes `status`, set `state_dirty=1` in same UPDATE statement. Renderer never sets it directly.

---

## CLAUDE.md footguns to avoid (REREAD `/Users/mklos/repos/central-tracking/CLAUDE.md`)

Three recurring bug families to watch for:

1. **Field-name drift through narrow inline IPC types.** When adding new preload bridge methods, type them with shared `Create*Input`/`Update*Input` interfaces from `src/shared/types.ts`, NOT inline object types. The renderer-side `CentralTrackingAPI` declaration is wider and won't catch param-name drift.

2. **Stale closure in `setX({...x, ...})`.** When ADO sync triggers a UI refresh, use functional update form: `setState(prev => ({...prev, ...}))`. The `ct:data-changed` event with 100ms debounce makes this easy to break.

3. **`await ipc(id); setState(result)` race.** When a plugin sync runs while user navigates, the result may be for the previously-selected task. Capture id in a ref before await, bail if changed (see `currentTaskIdRef` in `TaskDetail.tsx`).

---

## Stage 0 — Scaffolding

**Goal:** infrastructure ready, no user-visible feature.

**Tasks:**

1. **Schema migration 007** — append to `src/main/database/migrations.ts`. Run app once, confirm migration applies cleanly. Add a test in `src/main/database/__tests__/` that asserts the new columns exist.

2. **Shared types updates** — extend `Task` and `Comment` interfaces in `src/shared/types.ts` per the section above. Also update mock factories in `src/test/mocks/` so existing tests don't break when Task shape gains new fields (use `null`/`false` defaults).

3. **Row mapper updates:**
   - `src/main/ipc/taskHandlers.ts` — `rowToTask` returns new fields.
   - `src/main/ipc/commentHandlers.ts` — comment mapper returns `externalId`.
   - Update existing tests that snapshot Task/Comment shape.

4. **`state_dirty` auto-flip in task update handler** — in `taskHandlers.ts` update path, when `source='ado'` and `status` changed, also set `state_dirty=1`. Add test.

5. **Preload bridge** — add new methods to `src/main/preload.ts` and `CentralTrackingAPI` in `src/shared/types.ts`:
   - `tasksUpsertExternal(input: UpsertExternalTaskInput): Promise<Task>`
   - `commentsUpsertExternal(input: UpsertExternalCommentInput): Promise<Comment>`
   - `tasksSetExternalState(taskId: string, externalState: string): Promise<{ok: true}>`
   Use **named shared types** for inputs (CLAUDE.md footgun #1).

6. **IPC handlers + HTTP routes** for the three new methods. Register in `httpServer.ts` route table with `mutates: true`.

7. **Plugin scaffolding:**
   - `plugins/ado/package.json` — `name: "@central-tracking/plugin-ado"`, deps: `axios@^1`, `turndown@^7`, `marked@^11`, `yargs@^17`, devDep `typescript`.
   - `plugins/ado/tsconfig.json` — extends root, outputs to `plugins/ado/dist/`.
   - `plugins/ado/plugin.json`:
     ```json
     {
       "id": "ado",
       "name": "Azure DevOps Sync",
       "version": "0.1.0",
       "entrypoint": "node plugins/ado/dist/index.js"
     }
     ```
   - `plugins/ado/src/index.ts` — yargs skeleton with `pull`, `push`, `sync`, `refresh <taskId>`, all stubs printing "not implemented".
   - `plugins/ado/src/ct-client.ts` — reads `CT_SERVER_URL` + `CT_TOKEN` env, exposes typed methods for the IPC surface used by plugin.
   - `plugins/ado/src/config.ts` — `loadConfig()` reads plugin_config via ct API, returns typed config object. Throw on missing required keys (`pat`, `organization`, `project`).

8. **Root build wiring** — add `plugins/ado` to root `package.json` workspaces. Add `build:plugin:ado` script that runs `tsc` in `plugins/ado/`. Wire into top-level `build`.

9. **Plugin install test:** `npm run build:plugin:ado && ct plugin install plugins/ado/plugin.json` succeeds. `ct plugin config set ado pat foo` round-trips. `ct plugin run ado pull` prints "not implemented".

**Exit criteria:**
- [ ] Migration 007 applies; no test regressions; new columns visible via `sqlite3 .schema tasks`.
- [ ] `Task` and `Comment` typed shapes carry the new fields end-to-end (db → handler → IPC → renderer).
- [ ] Plugin installable, runnable, prints stub messages for all subcommands.
- [ ] Lint + full test suite green.

---

## Stage 1 — Pull + display

**Goal:** read-only ADO mirror in ct. User can see current sprint work items, ADO state, ADO total hours, link to ADO. No push yet.

**Plugin work:**

1. **`ado-client.ts`** — REST wrapper:
   - Base URL: `https://dev.azure.com/{organization}/{project}/_apis`
   - Auth: `Authorization: Basic ` + base64(`:` + PAT).
   - Methods: `getCurrentIteration(team)`, `wiqlQuery(iterationId, types, includeClosed)`, `getWorkItems(ids, fields)`, `getWorkItemComments(id)`.
   - Retry once on 5xx with exponential backoff (1s, 2s).

2. **`pull.ts`** orchestration:
   - Resolve current iteration: `GET _apis/work/teamsettings/iterations?$timeframe=current` (requires team in path: `_apis/{team}/_apis/...` — see ADO REST docs).
   - WIQL query built dynamically (no ADO macro for "pull closed"; build the string in JS):
     ```
     SELECT [System.Id]
     FROM WorkItems
     WHERE [System.IterationPath] = @currentIteration
       AND [System.WorkItemType] IN ('User Story', 'Bug', 'Task')   -- from config
       [+ AND [System.State] <> 'Closed']                            -- only if pull-closed=false
     ORDER BY [System.Id]
     ```
     `@currentIteration` IS a valid WIQL macro; `@project` too. The closed-filter is conditional JS string concat.
   - Batch fetch (max 200 per request) work items with fields: `System.Id`, `System.Title`, `System.Description`, `System.State`, `System.WorkItemType`, `Microsoft.VSTS.Scheduling.CompletedWork`, `System.ChangedDate`.
   - For each: compose `UpsertExternalTaskInput`:
     - `externalId: String(wi.id)`
     - `source: 'ado'`
     - `title: "#" + wi.id + " - " + wi.fields["System.Title"]`  (ASCII hyphen, NOT em-dash)
     - `notes: turndown.turndown(wi.fields["System.Description"] || "")`
     - `status: inverseStateMap(wi.fields["System.State"])`  (see fallback rule below)
     - `externalUrl: \`https://dev.azure.com/${org}/${proj}/_workitems/edit/${wi.id}\``
     - `externalState: wi.fields["System.State"]`
     - `externalCompletedHours: wi.fields["Microsoft.VSTS.Scheduling.CompletedWork"] ?? 0`
     - `externalRefreshedAt: now`
   - **`inverseStateMap` fallback:** when the ADO state matches no `altIn` list in the configured state-map, default to ct status `todo` and emit a stdout warning line `[ado] unmapped state "<state>" on #<id>, defaulting to todo`. Do NOT throw — sync should be best-effort.
   - **ct status names** are `todo | in-progress | done | blocked` (NOT `to-do | completed`). State-map config keys must match exactly.
   - Call `tasksUpsertExternal` for each.
   - For each task: fetch comments, build `UpsertExternalCommentInput[]`, call `commentsUpsertExternal` per comment.

3. **`refresh <taskId>`** — same as pull but for a single task (query work item by id, no iteration lookup).

**Backend work:**

1. **`tasks:upsertExternal` handler** — insert if `(source, external_id)` not found, else UPDATE. Field-level behavior:
   - On insert: generate uuid for `id`, set `sort_order` to `MAX(sort_order)+1` (per existing task-creation pattern in `taskHandlers.ts`), `created_at`/`updated_at = now`. Set all provided fields.
   - On update: overwrite title/notes/external_url/external_state/external_completed_hours/external_refreshed_at. Set status from input ONLY if `state_dirty=0` (don't clobber a pending local nudge). If status updated and matches `external_state` mapping → no-op for state_dirty.
   - Return full `Task` row.

2. **`comments:upsertExternal` handler** — insert if `external_id` not found, else UPDATE body. `synced=true`, `syncable=false` always for mirrored comments. Insert path: generate uuid for `id`, set `task_id` from input, `created_at`/`updated_at = now`.

3. **Renderer changes:**
   - File: `src/renderer/components/TaskDetail.tsx` (confirmed exists; CSS sibling `TaskDetail.css`).
   - When `task.source === 'ado'`, render new widget above existing fields:
     ```
     [#1234 - ADO Title]  ↗ Open in ADO
     State: Active     (last refresh 2026-05-16 14:32)
     ADO logged: 4.25 hrs
     Local pending: 0h 47m unreported
     ```
   - "Open in ADO" link uses existing `window.api.shell.openExternal(task.externalUrl)` — no new IPC needed.
   - Disable title and notes inputs (read-only) on ado-source tasks. Visual hint: muted color, lock icon.
   - In comments list: badge ADO-mirrored comments (`externalId !== null`) with "ADO" label. No edit/delete UI for them.

**Exit criteria:**
- [ ] `ct plugin run ado pull` populates current sprint tasks idempotently (re-run = no-op if no changes).
- [ ] `external_completed_hours`, `external_state`, `external_url`, `external_refreshed_at` visible in UI.
- [ ] ADO comments mirrored, marked read-only.
- [ ] Title/notes locked in UI for ado tasks.
- [ ] `ct plugin run ado refresh <taskId>` works for single task.
- [ ] Tests cover: insert path, update path with `state_dirty=0`, update path with `state_dirty=1` (status preserved), comment mirror dedup.

---

## Stage 2 — Time push

**Goal:** ct time logged → ADO `CompletedWork` (additive).

**Plugin work:**

1. **`push-time.ts`:**
   - Query ct: tasks where `source='ado' AND hasUnreportedTime=true` via existing `tasks:getAll` filter `hasUnreportedTime: true`.
   - For each task:
     a. Fetch unreported time entries: `timeEntries:getByTask` filtered to `reportedAt IS NULL`. (Add filter param if not present.)
     b. Sum `durationSeconds`.
     c. Round to `round-minutes` (config) via `round-mode`. Convert to hours decimal.
     d. **If rounded == 0:** skip task (entries stay unreported, accumulate next run).
     e. Fetch current ADO work item to get `rev` and current `CompletedWork`.
     f. PATCH `https://dev.azure.com/{org}/{proj}/_apis/wit/workitems/{id}?api-version=7.1`
        with `Content-Type: application/json-patch+json` body:
        ```json
        [{"op": "test", "path": "/rev", "value": <rev>},
         {"op": "add", "path": "/fields/Microsoft.VSTS.Scheduling.CompletedWork",
          "value": <currentHours + roundedHours>}]
        ```
        The `test` op makes the PATCH atomic vs the rev — ADO returns 409 if rev advanced.
     g. On 200: call `timeEntries:markTaskReported(taskId, now)`. Update `external_completed_hours` from response.
     h. On 409 (rev mismatch): refetch work item, recompute target, retry once.
     i. On other 4xx/5xx: log error, leave entries unreported, continue with next task.

2. **`sync.ts`** updates: `sync` command = `push-time → pull` (no comments/state push yet).

**Backend work:**

1. Add `reportedAt: null | undefined` filter param to `timeEntries:getByTask` if not present.

2. **Sanity check:** confirm `markTaskReported` only flips unreported entries (per existing test `markTaskReported with a timestamp marks only unreported entries`). It does — no change needed.

**Edge handling:**
- Partial sync interrupt: `markTaskReported` runs only after HTTP 200, so DB stays consistent.
- Rounding residual: stays unreported. Self-correcting next run.

**Exit criteria:**
- [ ] Time entries marked reported after successful PATCH.
- [ ] ADO `CompletedWork` increases by exactly rounded delta.
- [ ] Re-run does not double-push (no unreported entries means no work).
- [ ] Mid-run interrupt: DB consistent on next run.
- [ ] Concurrency conflict (rev mismatch) handled with retry.
- [ ] Tests cover: rounding modes, zero-rounded skip, partial-success isolation across tasks.

---

## Stage 3 — Comments push + state push

**Goal:** full bidi additive. User can manage state and comments entirely in ct.

**Plugin work:**

1. **`push-comments.ts`:**
   - Query ct: comments where `task.source='ado' AND syncable=true AND synced=false`. (Needs new IPC query or extension of existing `comments:getByTask` to filter by sync state, or a new `comments:getPendingSync` handler.)
   - For each comment: POST `_apis/wit/workItems/{externalId}/comments?api-version=7.1-preview.4`, body `{ "text": <markdown→html via marked> }`.
   - On 200: update local comment `synced=true`, `externalId=<response.id>`. (Existing `comments:update` accepts `synced`; add `externalId` to update input.)
   - On failure: leave `synced=false`, log.

2. **`push-state.ts`:**
   - Query ct: tasks where `source='ado' AND state_dirty=1`.
   - For each task:
     a. FSM validate locally (defensive): ct status → mapped ADO state must be a forward transition from `external_state`.
     b. PATCH `_apis/wit/workitems/{externalId}` body:
        ```json
        [{"op": "test", "path": "/rev", "value": <rev>},
         {"op": "add", "path": "/fields/System.State", "value": <mappedState>}]
        ```
     c. On 200: `tasksSetExternalState(taskId, mappedState)` → server clears `state_dirty` and updates `external_state`.
     d. On 400 with workflow rule error: log "ADO rejected transition from X to Y", leave `state_dirty=1`. Surface as plugin stdout warning.

3. **`sync.ts`** updated: `sync` = `push-state → push-time → push-comments → pull`.
   - State first so that subsequent time/comment posts apply against the new state.
   - Pull last so display reflects final ADO state including this run's pushes.

4. **Auto-comment for time push** (optional, config-gated):
   - If `auto-comment-on-time-push=true`: after a successful time push for a task, build a comment from the entry notes batched in that push:
     ```
     +1h 15m logged 2026-05-16:
     - <entry 1 note>
     - <entry 2 note>
     ```
   - POST as ADO comment in same run.

**Backend work:**

1. **`comments:update`** — accept optional `externalId` field. Update test.

2. **`comments:getPendingSync`** new handler — return comments where `syncable=true AND synced=false`, optionally filtered by `taskId` or `source`. HTTP route + IPC.

3. **`tasks:setExternalState`** handler — set `external_state` to provided value, set `state_dirty=0`. HTTP route + IPC.

4. **`plugins:getConfig(pluginId, key)`** new handler — return the stored config value as a string. Renderer uses this to read the state-map JSON for FSM display. HTTP route + IPC. (Existing CLI `ct plugin config get` already reads from `plugin_config`; this exposes the same to IPC/renderer.)

4. **Renderer FSM enforcement:**
   - `TaskDetail.tsx` status dropdown for `source==='ado'`: filter options per FSM derived from current `external_state` (computed via state-map config).
   - State-map config exposed to renderer via a new IPC: `plugins:getConfig('ado', 'state-map')` returning parsed JSON.
   - Reopen (`completed → in-progress`): present with inline warning text: "ADO may reject; will revert from ADO on next pull if so."

5. **Backend FSM validation** in `tasks:update`: if `source='ado'` and `status` changes, reject transitions not in the allowed set. HTTP 400 with code `INVALID_AD0_TRANSITION`.

**Exit criteria:**
- [ ] Syncable+unsynced comments post to ADO, get marked `synced=true` with returned `externalId`.
- [ ] ct status change → next sync push to ADO.
- [ ] FSM-illegal transitions blocked in UI and backend.
- [ ] ADO workflow rejection: state_dirty stays 1, warning visible in plugin output, doesn't break rest of sync.
- [ ] External ADO state change → pulled, overwrites ct status (because state_dirty=0 after successful push).
- [ ] `auto-comment-on-time-push` config flag works and is off by default.
- [ ] Tests cover all transitions, workflow rejection, comment id roundtrip.

---

## Cross-cutting concerns

**Testing:**
- Mock ADO REST via `msw` (preferred) or `nock`.
- Integration test: in-memory sqlite + plugin process invoked with `--dry-run` flag, asserts HTTP calls without real ADO.
- Snapshot test: pull → push → pull cycle on a fixture work item.

**Logging:**
- Plugin writes structured JSON to stdout (consumed by `ct plugin run` output). One line per action.
- Errors include ADO response body when available.

**Security:**
- PAT lives only in `plugin_config` table, never logged.
- Plugin uses loopback ct API exclusively. No outbound from ct itself.
- ADO API calls use HTTPS only.

**Build:**
- `plugins/ado/dist/` is the artifact. Top-level `npm run build` includes plugin build.
- `.gitignore` already excludes `dist/`; verify.

**Periodic sync:**
- Out of scope for plugin v1. Document in `plugins/ado/README.md` how to set up via launchd (macOS) and Task Scheduler (Windows) using `ct plugin run ado sync`.

---

## Quick-reference: existing things to leverage

- `markTaskReported(taskId, reportedAt)` — flips unreported entries only, preserves prior reportedAt. Already tested.
- `task.unreportedTimeSeconds` and `task.hasUnreportedTime` — computed in `rowToTask`, available everywhere.
- `TaskFilterParams.source` accepts array — `?source=ado` works for filtering.
- `TaskFilterParams.hasUnreportedTime: true` — already supported.
- HTTP route table in `src/main/server/httpServer.ts` — new routes go there with `mutates: true` for anything that writes.
- `webContents.send('ct:data-changed')` fires after mutations — renderer contexts already subscribe with 100ms debounce. New IPC handlers should follow this pattern.
- Plugin install/config CLI commands already work (`ct plugin install/config set/run`).
- `ParsedImportItem` exists but is for markdown import — do NOT route ADO pull through it. Use dedicated `tasks:upsertExternal` so we control field semantics precisely.
