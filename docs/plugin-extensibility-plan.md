# Plugin Extensibility Implementation Plan

Audit date: 2026-05-20. Targets the work to do *before* adding a second
plugin (GitHub, Jira, Linear, …) so we don't multiply ADO-specific
patterns by N.

The items are grouped by priority. **P0** items should land before plugin
#2 is started — they reshape data and API surface, and doing them after
the fact means rewriting plugin #2. **P1** items can land any time but
get cheaper if done before plugin #2 has shipped. **P2** items wait
until we have two concrete plugins to compare for real duplication.

Each item lists the problem with file:line citations, concrete
implementation steps, test plan, and migration notes where applicable.

---

## Status

| Priority | Items | State | Owner | Branch |
|---|---|---|---|---|
| **P0** | 1, 2, 3 (bundled) | **Active — next up** | unassigned | tbd |
| P1 | 4, 5, 6 | Queued — start after P0 merges | — | — |
| P2 | 7, 8, 9 | Deferred until plugin #2 has a working POC | — | — |

**Current focus:** P0 bundle. Single owner recommended — items share a
migration (008) and ADO call-site updates; splitting them creates
merge pain. See the Handoff log at the bottom for live progress.

---

## P0 — Land these together (one migration, one PR)

Items 1, 2, and 3 all touch `src/shared/types.ts`, the task schema, or
the ADO plugin's imports. Doing them piecemeal would mean either two
migrations or a partially-typed plugin client. Bundle them.

### 1. Decouple `TaskSource` from ADO; key external tasks by `pluginId`

**Status:** Not started.

**Problem.** `TASK_SOURCES` hardcodes `'ado'` at `src/shared/types.ts:3`,
and the unique index keying external tasks is `(source, external_id)`
(migration 007, `src/main/database/migrations.ts:112-113`). Every new
plugin would have to either reuse `'plugin'` (collisions across
plugins) or add itself to the enum + ship a migration.

**Implementation.**

1. Add migration 008 that:
   - Adds `tasks.plugin_id TEXT NULL REFERENCES plugins(id)` (no
     ON DELETE — we want the FK violation if someone uninstalls a
     plugin that owns tasks; uninstall already refuses to remove
     bundled plugins, and sideloaded uninstall should grow a
     `tasks-owned` check).
   - Backfills `plugin_id = 'ado'` for every row where `source = 'ado'`.
   - Drops the old `idx_tasks_source_external` unique index.
   - Creates `idx_tasks_plugin_external` as
     `UNIQUE (plugin_id, external_id) WHERE external_id IS NOT NULL`.
   - Updates the CHECK constraint on `tasks.source` to drop `'ado'`
     and keeps `('ad-hoc', 'email', 'meeting-prep', 'plugin')`.
   - For every backfilled row, sets `source = 'plugin'`.
2. Edit `src/shared/types.ts:3` — remove `'ado'` from `TASK_SOURCES`;
   add `pluginId: string | null` to the `Task` interface (around
   line 14, beside `source`).
3. Edit `tasks:upsertExternal` in `src/main/ipc/taskHandlers.ts` to:
   - accept `pluginId` (required for plugin-owned tasks) in the
     `UpsertExternalTaskInput` shape.
   - match on `(plugin_id, external_id)` instead of
     `(source, external_id)`.
   - always set `source = 'plugin'` when `pluginId` is non-null.
4. Update the ADO plugin's call sites (`plugins/ado/src/sync.ts`,
   `plugins/ado/src/pull.ts`) to pass `pluginId: 'ado'`. The
   `CtClient.upsertExternalTask` signature in
   `plugins/ado/src/ct-client.ts:144` picks up the new field
   automatically via shared types.
5. The renderer's task-list rendering currently special-cases
   `task.source === 'ado'` in a few spots (find via
   `grep -rn "'ado'" src/renderer`). Replace with checks on
   `task.pluginId !== null` for "is plugin-owned" decisions, and on
   `task.pluginId === '<id>'` for plugin-specific affordances.

**Tests.**

- New migration test: insert ADO-style task pre-migration, run
  migration 008, assert `plugin_id='ado'`, `source='plugin'`, and the
  new unique index rejects a duplicate `(plugin_id, external_id)`.
- `tasks:upsertExternal` test: same external_id under different
  pluginIds creates two rows.
- Update existing ADO integration tests to pass `pluginId`.

**Migration notes.** This is breaking for the on-disk schema. Anyone
with an ADO-tracked db will get rows migrated to `source='plugin',
plugin_id='ado'`. Confirm no production users yet — if there are, this
is still a one-shot migration; we just have to make sure 008 is
idempotent (use `WHERE source = 'ado'` guards).

**Effort:** M (~1 day with tests).

---

### 2. Move ADO-specific types out of `src/shared/types.ts`

**Status:** Not started.

**Problem.** `AdoStateMapEntry`, `AdoStateMap`, and
`ADO_DEFAULT_STATE_MAP` live in `src/shared/types.ts:182-191`. The
renderer imports them directly to render state-map config UI. A
GitHub plugin would either copy the pattern in `shared/types.ts` (file
grows linearly with plugin count) or reuse the wrong types.

**Implementation.**

1. Move the three symbols from `src/shared/types.ts:182-191` to
   `plugins/ado/src/types.ts` (where the rest of ADO types already
   live).
2. Find existing importers — `grep -rn "AdoStateMap\|ADO_DEFAULT_STATE_MAP" src`.
3. For the renderer, the right answer isn't to import from
   `plugins/ado/src/types.ts` (the renderer must not depend on plugin
   sources). Instead, the renderer should read the state-map shape
   from the per-plugin capabilities endpoint (item 4) and treat it
   as `Record<string, { external: string; alternates: string[] }>`
   — same shape but plugin-agnostic.
4. The `adoFsm.ts` helper at `src/renderer/utils/adoFsm.ts` should
   either move into the plugin's renderer-side bundle (future work)
   or — for now — keep its own local copy of the type, since the
   FSM itself is genuinely ADO-specific logic. Mark it with a
   comment noting that it will be relocated when plugins ship
   their own renderer bundles.

**Tests.** No behavioural change. Type checking + lint covers it.

**Effort:** S (couple hours, mostly chasing imports).

---

### 3. Extract `@central-tracking/plugin-client` (or local equivalent)

**Status:** Not started.

**Problem.** `plugins/ado/src/ct-client.ts` (189 LOC) and
`plugins/ado/src/config.ts` (67 LOC) contain the HTTP wrapper, env-var
shadowing of secrets, env-merge for config (`listPluginConfig` at
`ct-client.ts:88-118`), and required-key gating. A second plugin would
copy ~250 LOC verbatim. The env-shadowing logic is the non-trivial
part and is easy to get subtly wrong (see CLAUDE.md footgun #1 — same
class of bug).

**Implementation.**

1. Create `plugins/_shared/` with:
   - `package.json` — `name: "@central-tracking/plugin-client"`,
     `private: true`, `main: "dist/index.js"`,
     `types: "dist/index.d.ts"`.
   - `tsconfig.json` — compiles to its own `dist/`.
   - `src/index.ts` — barrel re-export.
   - `src/ct-client.ts` — copy of the ADO version, with the
     constructor taking `pluginId` as a required param (today it
     defaults to `'ado'` at `plugins/ado/src/ct-client.ts:54`).
   - `src/load-config.ts` — generic version of
     `plugins/ado/src/config.ts`:
     ```ts
     export async function loadConfig<T>(
       client: CtClient,
       requiredKeys: readonly string[],
       parse: (map: Record<string, string>) => T,
     ): Promise<T>;
     ```
   - `src/types.ts` — re-export `CtTask`, `CtComment`,
     `CtTimeEntry`, `UpsertExternalTaskInput`, etc. from
     `../../../src/shared/types.ts`. Plugins import from
     `@central-tracking/plugin-client/types`, never from
     `central-tracking/src/shared/types.ts`.
2. Each plugin's `tsconfig.json` gets a path alias:
   ```json
   "paths": {
     "@central-tracking/plugin-client": ["../_shared/src"]
   }
   ```
3. Each plugin's `package.json` gets the local file dep
   (`"file:../_shared"`) so production bundling works.
4. Migrate `plugins/ado/` to use the shared package:
   - Delete `plugins/ado/src/ct-client.ts`.
   - Rewrite `plugins/ado/src/config.ts` to call `loadConfig` from
     the shared package, passing ADO-specific defaults and parsing.
   - `plugins/ado/src/types.ts` re-exports from the shared types
     module + adds ADO-specific local types.

**Tests.**

- Move the existing `ct-client.test.ts` unit tests into
  `plugins/_shared/src/__tests__/`.
- Add an integration test that constructs a `CtClient` with a custom
  `pluginId` and exercises `listPluginConfig` env shadowing.
- Existing ADO integration tests should keep passing without changes
  beyond import path updates.

**Migration notes.** Don't publish to npm yet — local file dep is
fine. If we ever ship plugins as standalone packages we'll graduate
this to a real published package then.

**Effort:** M (~1 day). Most of the work is mechanical (move +
parameterize); the integration test for the env-shadowing path is
the real value.

---

## P1 — Independent; land any time

### 4. Generic plugin capabilities endpoint

**Problem.** `src/renderer/hooks/usePluginCapabilities.ts:12,28` reads
a single hardcoded config key (`tracks-reported`) per plugin. The
moment we add a second capability flag this becomes an N-key fan-out
with no contract.

**Implementation.**

1. Extend `PluginManifest` (`src/shared/types.ts:345`) with optional
   `capabilities?: Record<string, unknown>`.
2. Add a manifest-validation rule in
   `validatePluginManifest` (`src/main/ipc/pluginHandlers.ts:106-128`):
   `capabilities` must be a plain JSON object if present (no
   functions, no nested validation — let plugins evolve their own
   shapes).
3. Add `plugins:getCapabilities` IPC handler in
   `src/main/ipc/pluginHandlers.ts`:
   ```ts
   ipcMain.handle('plugins:getCapabilities', (_e) => {
     return listPlugins(db).map(p => ({
       id: p.id,
       enabled: p.enabled,
       capabilities: p.manifest.capabilities ?? {},
     }));
   });
   ```
4. Add the route to `src/main/server/apiManifest.ts` with
   `mutates: false`, no event. (HTTP exposure lets plugins read
   each other's capabilities if needed.)
5. Add the typed method to `CentralTrackingAPI` in
   `src/shared/types.ts:431` (the preload bridge) and to the CLI
   client at `src/cli/api.ts`.
6. Rewrite `usePluginCapabilities` to call the new endpoint instead
   of fanning out N `getConfig` calls. The hook now returns
   `Record<string, { enabled: boolean; capabilities: unknown }>`.
   Callers cast to the shape they expect.
7. Move the existing `tracks-reported` semantics into the ADO
   manifest under `capabilities.tracksReported: true` (still
   user-overridable via the config key — capabilities are the
   default, config keys are the override).

**Tests.**

- Parity test (`apiManifest.parity.test.ts`) catches missing
  manifest entry automatically.
- New `usePluginCapabilities.test.tsx` — mock the IPC return,
  assert the hook surfaces capabilities correctly. Verify it
  refreshes on `data-changed`.
- Renderer regression: tasks owned by a plugin whose manifest
  doesn't declare `tracksReported` should default to `true`
  (matches the historical config-key default at
  `usePluginCapabilities.ts:31`).

**Effort:** S (~half day).

---

### 5. Version the webhook envelope

**Problem.** `WebhookEvent` (`src/shared/types.ts:422-427`) has no
`version` field. Adding a payload field later means plugins either
tolerate-unknown or break, and the host can't detect a
version-mismatched plugin.

**Implementation.**

1. Add `version: '1'` to the `WebhookEvent` interface in
   `src/shared/types.ts:422`.
2. Set the field at the dispatch site in
   `src/main/server/httpServer.ts` (wherever the `WebhookEvent`
   literal is built before calling `dispatchEvent`). One-line
   change.
3. Update `plugins/ado/src/index.ts` (the webhook receiver) to
   read `event.version` and log a warning if it sees an unknown
   version. No hard failure — plugins should tolerate forward
   compatibility for additive changes.
4. Document the field as bump-on-breaking-change in
   `docs/plugins.md` under the webhook section.

**Tests.**

- Update `webhooks.test.ts` snapshot/assertion to include
  `version: '1'`.

**Migration notes.** No DB or wire-format break for `'1'` consumers
since this is additive. The ADO plugin already accepts whatever shape
we send it; the test is the only thing that pins the shape.

**Effort:** S (~30 min).

---

### 6. Gate `plugins:setEnabled` on required config

**Problem.** `setPluginEnabled` (`src/main/ipc/pluginHandlers.ts:210`,
registered at line 416) doesn't consult `configSchema`. The UI can
toggle a plugin on whose webhooks then silently no-op until config
is set. Compare with `ct plugin run`, which already gates.

**Implementation.**

1. Add a helper in `src/main/ipc/pluginHandlers.ts`:
   ```ts
   export function getMissingRequiredKeys(
     db: Database, pluginId: string,
   ): string[] {
     return getPluginConfigSchema(db, pluginId)
       .filter(s => s.required && s.status === 'unset')
       .map(s => s.key);
   }
   ```
2. Modify `setPluginEnabled` to call it when `enabled === true`,
   and throw `new DomainError('INCOMPLETE_CONFIG', \`...keys: ${missing.join(', ')}\`)`.
3. In the renderer's plugin-toggle handler, catch the
   `INCOMPLETE_CONFIG` code and surface it as a toast pointing the
   user to the config UI for that plugin.

**Tests.**

- New IPC test: install a plugin with `configSchema` having a
  required key; call `setPluginEnabled(id, true)` → expect throw
  with code `INCOMPLETE_CONFIG`.
- Setting `enabled = false` is always allowed (no gate).
- Setting `enabled = true` after the required key is set succeeds.

**Effort:** S (~1 hour including tests).

---

## P2 — Defer until plugin #2 is in flight

### 7. Typed `PluginConfigKeySpec`

**Problem.** Today every config value is a string; each plugin parses
its own types inline (`Number(map['round-minutes'])` at
`plugins/ado/src/config.ts:55`, `JSON.parse(map['state-map'])` at line
44). A typed schema (`type: 'string'|'number'|'boolean'|'json'`,
optional `enum`/`pattern`/`default`) would let the CLI validate on
`set` and the renderer render appropriate inputs.

**Why defer.** Until plugin #2 ships and we see whether its config has
the same shape (likely yes) or something we haven't anticipated, we'd
be guessing at the schema. Land items 1–6 first, then revisit.

---

### 8. Move `WebhookSubscriber` to the right layer

**Problem.** `src/main/server/webhooks.ts:5` imports `WebhookSubscriber`
from `src/main/ipc/pluginHandlers.ts`. The IPC handler module is a
back-channel dependency of the server module.

**Implementation.** Move the type to `src/shared/types.ts` (it's a
pure data shape) or to `src/main/server/types.ts` (if we want a
server-local types module). One-line import change at the top of
`webhooks.ts`.

**Why low priority.** It's a cosmetic / import-cycle-risk fix, not a
correctness one. Roll it in with the next time someone touches
`webhooks.ts`.

---

### 9. Don't extract a "plugin utils" package yet

The audit suggested factoring out retry/backoff/rate-limit helpers
proactively. ADO doesn't yet use these heavily — the only retry-like
pattern is axios's built-in timeout handling. Pre-factoring before
seeing what plugin #2 actually needs would create the wrong
abstraction. Revisit after plugin #2 lands and we have real
duplication to compare.

---

## Sequencing

Recommended order (also the implementation order if a single dev does
the work):

1. **P0 bundle:** items 1 + 2 + 3 in one PR. The migration is the
   gating piece; doing types-move and client-extract in the same PR
   means only one round of "update all the ADO call sites."
2. **Item 5** (webhook version). 30-minute change, ship anytime.
3. **Item 6** (gate setEnabled). 1-hour change with tests.
4. **Item 4** (capabilities endpoint). Half-day; lands the renderer
   pattern that future plugins lean on.
5. P2 items: revisit after plugin #2 has a working POC.

After all of this, a new plugin should be ~50 LOC of glue + its
sync-specific logic, with no edits to `src/shared/types.ts`, no
migrations, and no copy-pasted client code.

---

## Handoff log

Newest entry at the top. Each entry should answer:
- **Done:** what landed (commit hashes, PR numbers).
- **In flight:** what's mid-implementation, where the cursor is, any
  WIP commits.
- **Next:** what the next session should pick up first.
- **Blockers / open questions:** anything that needs a human decision
  before proceeding.

Update the **Status** table at the top of this file in the same edit
so the at-a-glance view stays accurate.

### 2026-05-20 — Plan created

- **Done:** Audit + ranked recommendations. Plan committed
  (`ecf11ec`) and pushed to
  `claude/review-codebase-recommendations-mMBQ8`. P0/P1/P2 grouping
  agreed. Status table + handoff log structure added.
- **In flight:** none.
- **Next:** start P0 item 1 (migration 008 + `pluginId` column + 
  `(plugin_id, external_id)` unique index). Item 1 is the gating
  schema change; items 2 and 3 can begin once 1 is at PR-ready state.
- **Blockers / open questions:**
  - Item 1 step 1: should sideloaded-plugin uninstall grow a
    `tasks-owned` refusal, or just succeed and orphan the task rows?
    Current uninstall (`uninstallPlugin` in `pluginHandlers.ts`)
    refuses bundled plugins only. The migration introduces an FK
    that would otherwise fail loudly on uninstall — easier to make
    that an explicit check.
  - Item 3: confirm `plugins/_shared/` (local file dep) is the right
    landing place vs `packages/plugin-client/` if we ever want a
    monorepo layout. Not blocking — can move later.
