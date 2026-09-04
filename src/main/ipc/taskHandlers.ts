import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { CreateTaskInput, Task, TaskStatus, UpdateTaskInput, BatchUpdateInput, PaginationParams, PaginatedResponse, TaskSortBy, TaskQueryParams, UpsertExternalTaskInput, LinkTaskInput } from '../../shared/types';
import { toIsoStartOfDay, toIsoEndOfDay } from '../../shared/dateRange';
import { DomainError } from '../errors';
import { isAllowedAdoTransition } from '../../shared/adoFsm';
import { resolveTaskId } from './taskLookup';
import { sqliteTimeToIso } from '../sqliteTime';

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  source: string;
  external_id: string | null;
  plugin_id: string | null;
  sort_order: number;
  notes: string;
  deleted_at: string | null;
  external_url: string | null;
  external_state: string | null;
  external_completed_hours: number | null;
  external_refreshed_at: string | null;
  state_dirty: number;
  created_at: string;
  updated_at: string;
}

function rowToTask(db: Database, row: TaskRow): Task {
  const catRows = db.instance
    .prepare('SELECT category_id FROM task_categories WHERE task_id = ?')
    .all(row.id) as { category_id: string }[];

  const totalTime = db.instance
    .prepare(
      `SELECT COALESCE(SUM(
        CASE WHEN end_time IS NOT NULL
          THEN CAST(ROUND((julianday(end_time) - julianday(start_time)) * 86400) AS INTEGER)
          ELSE 0
        END
      ), 0) as total FROM time_entries WHERE task_id = ?`
    )
    .get(row.id) as { total: number };

  const todayTime = db.instance
    .prepare(
      `SELECT COALESCE(SUM(
        CASE WHEN end_time IS NOT NULL
          THEN CAST(ROUND((julianday(end_time) - julianday(start_time)) * 86400) AS INTEGER)
          ELSE 0
        END
      ), 0) as total FROM time_entries WHERE task_id = ? AND date(start_time, 'localtime') = date('now', 'localtime')`
    )
    .get(row.id) as { total: number };

  const unreportedTime = db.instance
    .prepare(
      `SELECT COALESCE(SUM(
        CASE WHEN end_time IS NOT NULL
          THEN CAST(ROUND((julianday(end_time) - julianday(start_time)) * 86400) AS INTEGER)
          ELSE 0
        END
      ), 0) as total FROM time_entries WHERE task_id = ? AND reported_at IS NULL`
    )
    .get(row.id) as { total: number };

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Task['status'],
    source: row.source as Task['source'],
    externalId: row.external_id,
    pluginId: row.plugin_id,
    sortOrder: row.sort_order,
    totalTimeSeconds: totalTime.total,
    todayTimeSeconds: todayTime.total,
    unreportedTimeSeconds: unreportedTime.total,
    hasUnreportedTime: unreportedTime.total > 0,
    categoryIds: catRows.map((r) => r.category_id),
    notes: row.notes ?? '',
    deletedAt: sqliteTimeToIso(row.deleted_at),
    externalUrl: row.external_url,
    externalState: row.external_state,
    externalCompletedHours: row.external_completed_hours,
    externalRefreshedAt: row.external_refreshed_at,
    stateDirty: row.state_dirty === 1,
    createdAt: sqliteTimeToIso(row.created_at),
    updatedAt: sqliteTimeToIso(row.updated_at),
  };
}

function getSortOrderClause(sortBy: TaskSortBy | undefined, isDone: boolean): string {
  switch (sortBy) {
    case 'recent':
      return `(SELECT MAX(COALESCE(end_time, start_time)) FROM time_entries WHERE task_id = tasks.id) DESC NULLS LAST, created_at DESC`;
    case 'created':
      return `created_at DESC, rowid DESC`;
    case 'alphabetical':
      return `title COLLATE NOCASE ASC`;
    case 'most-time-today':
      return `(SELECT COALESCE(SUM(
        CASE WHEN end_time IS NOT NULL
          THEN CAST(ROUND((julianday(end_time) - julianday(start_time)) * 86400) AS INTEGER)
          ELSE CAST(ROUND((julianday('now') - julianday(start_time)) * 86400) AS INTEGER)
        END
      ), 0) FROM time_entries WHERE task_id = tasks.id AND date(start_time, 'localtime') = date('now', 'localtime')) DESC, created_at DESC`;
    case 'manual':
    default:
      return isDone ? `updated_at DESC` : `sort_order ASC, created_at DESC`;
  }
}

function toArray(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function buildFilterClauses(params?: TaskQueryParams): { clauses: string[]; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (params?.search) {
    const pattern = `%${params.search}%`;
    if (params.searchIn === 'all') {
      clauses.push('(title LIKE ? OR description LIKE ? OR notes LIKE ?)');
      values.push(pattern, pattern, pattern);
    } else {
      clauses.push('title LIKE ?');
      values.push(pattern);
    }
  }

  const statuses = toArray(params?.status);
  if (statuses.length) {
    clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    values.push(...statuses);
  }

  const sources = toArray(params?.source);
  if (sources.length) {
    clauses.push(`source IN (${sources.map(() => '?').join(', ')})`);
    values.push(...sources);
  }

  if (params?.pluginId === null) {
    clauses.push('plugin_id IS NULL');
  } else if (params?.pluginId !== undefined) {
    const pluginIds = Array.isArray(params.pluginId) ? params.pluginId : [params.pluginId];
    if (pluginIds.length) {
      clauses.push(`plugin_id IN (${pluginIds.map(() => '?').join(', ')})`);
      values.push(...pluginIds);
    }
  }

  const categoryIds = toArray(params?.categoryId);
  if (categoryIds.length) {
    const placeholders = categoryIds.map(() => '?').join(', ');
    clauses.push(`id IN (SELECT task_id FROM task_categories WHERE category_id IN (${placeholders}))`);
    values.push(...categoryIds);
  }

  if (params?.hasUnreportedTime === true) {
    // Include only tasks that have at least one un-reported time entry.
    // Tasks with no entries at all are excluded (nothing to report).
    clauses.push(
      `EXISTS (SELECT 1 FROM time_entries WHERE task_id = tasks.id AND reported_at IS NULL)`,
    );
  }

  if (params?.uncategorized === true) {
    // Include only tasks that have no categories assigned.
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM task_categories WHERE task_id = tasks.id)`,
    );
  }

  const dateStart = params?.dateStart && params.dateStart.length > 0 ? params.dateStart : undefined;
  const dateEnd = params?.dateEnd && params.dateEnd.length > 0 ? params.dateEnd : undefined;
  if (dateStart || dateEnd) {
    // Include only tasks with at least one time entry whose start_time falls
    // within the bounds. Each bound is independent: omitted = unbounded on
    // that side.
    const conds: string[] = ['task_id = tasks.id'];
    const dateValues: unknown[] = [];
    if (dateStart) {
      conds.push('start_time >= ?');
      dateValues.push(toIsoStartOfDay(dateStart));
    }
    if (dateEnd) {
      conds.push('start_time <= ?');
      dateValues.push(toIsoEndOfDay(dateEnd));
    }
    clauses.push(`EXISTS (SELECT 1 FROM time_entries WHERE ${conds.join(' AND ')})`);
    values.push(...dateValues);
  }

  return { clauses, values };
}

/**
 * The ADO status gate, shared by `updateTask` and `batchUpdateTasks`.
 *
 * ADO full-mirror tasks (source='plugin' AND plugin_id='ado'): enforce the FSM
 * and mark state_dirty so push-state syncs the new state. The plugin clears
 * the flag via setExternalState after a successful push.
 *
 * Link-only ADO tasks (plugin_id='ado' but source != 'plugin', e.g. 'ad-hoc'
 * or 'email') are NOT FSM-gated and NOT marked state_dirty. The user added a
 * link for time/comment push convenience; status is still local-only and free
 * to move in any direction.
 *
 * Returns whether the caller should set `state_dirty = 1`; throws when the
 * transition is illegal.
 */
function checkAdoStatusChange(db: Database, id: string, nextStatus: string): { markDirty: boolean } {
  const current = db.instance
    .prepare('SELECT plugin_id, source, status FROM tasks WHERE id = ?')
    .get(id) as { plugin_id: string | null; source: string; status: string } | undefined;

  if (
    !current ||
    current.plugin_id !== 'ado' ||
    current.source !== 'plugin' ||
    current.status === nextStatus
  ) {
    return { markDirty: false };
  }

  if (!isAllowedAdoTransition(current.status as TaskStatus, nextStatus as TaskStatus)) {
    throw new DomainError(
      'INVALID_ADO_TRANSITION',
      `Illegal ADO transition: ${current.status} → ${nextStatus}`,
    );
  }
  return { markDirty: true };
}

// ─── Exported handler functions (used by both IPC and HTTP server) ───

export function getAllTasks(db: Database): Task[] {
  const rows = db.instance
    .prepare('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at DESC')
    .all() as TaskRow[];
  return rows.map((row) => rowToTask(db, row));
}

export function getTaskById(db: Database, id: string): Task | null {
  const fullId = id.length < 36 ? (() => { try { return resolveTaskId(db, id); } catch { return null; } })() : id;
  if (!fullId) return null;
  const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').get(fullId) as TaskRow | undefined;
  return row ? rowToTask(db, row) : null;
}

export function getActiveTaskIds(db: Database, params?: TaskQueryParams): string[] {
  const { clauses, values } = buildFilterClauses(params);
  const baseWhere = "status != 'done' AND deleted_at IS NULL";
  const where = clauses.length > 0 ? `${baseWhere} AND ${clauses.join(' AND ')}` : baseWhere;
  const rows = db.instance
    .prepare(`SELECT id FROM tasks WHERE ${where}`)
    .all(...values) as { id: string }[];
  return rows.map((r) => r.id);
}

export function getActiveTasks(db: Database, params?: TaskQueryParams): PaginatedResponse<Task> {
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 50;
  const orderBy = getSortOrderClause(params?.sortBy, false);
  const { clauses, values } = buildFilterClauses(params);

  const baseWhere = "status != 'done' AND deleted_at IS NULL";
  const where = clauses.length > 0
    ? `${baseWhere} AND ${clauses.join(' AND ')}`
    : baseWhere;

  const rows = db.instance
    .prepare(
      `SELECT * FROM tasks WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset) as TaskRow[];
  const countRow = db.instance
    .prepare(`SELECT COUNT(*) as total FROM tasks WHERE ${where}`)
    .get(...values) as { total: number };
  const items = rows.map((row) => rowToTask(db, row));
  return {
    items,
    total: countRow.total,
    offset,
    limit,
    hasMore: offset + items.length < countRow.total,
  };
}

export function getDoneTasks(db: Database, params?: TaskQueryParams): PaginatedResponse<Task> {
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 50;
  const orderBy = getSortOrderClause(params?.sortBy, true);
  const { clauses, values } = buildFilterClauses(params);

  const baseWhere = "status = 'done' AND deleted_at IS NULL";
  const where = clauses.length > 0
    ? `${baseWhere} AND ${clauses.join(' AND ')}`
    : baseWhere;

  const rows = db.instance
    .prepare(
      `SELECT * FROM tasks WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset) as TaskRow[];
  const countRow = db.instance
    .prepare(`SELECT COUNT(*) as total FROM tasks WHERE ${where}`)
    .get(...values) as { total: number };
  const items = rows.map((row) => rowToTask(db, row));
  return {
    items,
    total: countRow.total,
    offset,
    limit,
    hasMore: offset + items.length < countRow.total,
  };
}

export function createTask(db: Database, input: CreateTaskInput): Task {
  const id = uuidv4();
  const now = new Date().toISOString();

  const maxOrder = db.instance
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM tasks')
    .get() as { next: number };

  db.instance
    .prepare(
      `INSERT INTO tasks (id, title, description, status, source, external_id, plugin_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.title,
      input.description ?? '',
      input.status ?? 'todo',
      input.source ?? 'ad-hoc',
      input.externalId ?? null,
      input.pluginId ?? null,
      maxOrder.next,
      now,
      now
    );

  if (input.categoryIds?.length) {
    const insertCat = db.instance.prepare(
      'INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)'
    );
    for (const catId of input.categoryIds) {
      insertCat.run(id, catId);
    }
  }

  const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  return rowToTask(db, row);
}

export function updateTask(db: Database, id: string, updates: UpdateTaskInput): Task {
  id = resolveTaskId(db, id);
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    sets.push('description = ?');
    values.push(updates.description);
  }
  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    values.push(updates.sortOrder);
  }
  if (updates.source !== undefined) {
    sets.push('source = ?');
    values.push(updates.source);
  }
  if (updates.notes !== undefined) {
    sets.push('notes = ?');
    values.push(updates.notes);
  }

  if (updates.status !== undefined) {
    if (checkAdoStatusChange(db, id, updates.status).markDirty) {
      sets.push('state_dirty = 1');
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    values.push(id);
    db.instance.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  if (updates.categoryIds !== undefined) {
    const categoryIds = updates.categoryIds;
    const insertCat = db.instance.prepare(
      'INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)'
    );
    // Same hazard as assignCategoriesToTask: `OR IGNORE` does not cover
    // foreign-key violations, so an unknown id throws after the DELETE has
    // committed and the task loses every category it had.
    db.instance.transaction(() => {
      db.instance.prepare('DELETE FROM task_categories WHERE task_id = ?').run(id);
      for (const catId of categoryIds) {
        insertCat.run(id, catId);
      }
    })();
  }

  const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  return rowToTask(db, row);
}

export function deleteTask(db: Database, id: string): void {
  id = resolveTaskId(db, id);
  db.instance
    .prepare("UPDATE tasks SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
    .run(id);
}

export function reorderTasks(db: Database, orderedIds: string[]): void {
  const update = db.instance.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
  const transaction = db.instance.transaction(() => {
    orderedIds.forEach((id, index) => {
      update.run(index, id);
    });
  });
  transaction();
}

export function batchUpdateTasks(db: Database, ids: string[], input: BatchUpdateInput): { updatedCount: number } {
  const transaction = db.instance.transaction(() => {
    for (const id of ids) {
      const sets: string[] = [];
      const values: unknown[] = [];

      if (input.status !== undefined) {
        // Same gate as updateTask. Without it a batch status change on an ADO
        // mirror task skipped the FSM and never set state_dirty, so it was
        // never pushed and the next pull reverted it. An illegal transition
        // aborts the whole batch: the work is already inside one transaction,
        // so failing loudly beats applying it to some tasks and not others.
        if (checkAdoStatusChange(db, id, input.status).markDirty) {
          sets.push('state_dirty = 1');
        }
        sets.push('status = ?');
        values.push(input.status);
      }
      if (input.source !== undefined) {
        sets.push('source = ?');
        values.push(input.source);
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        values.push(id);
        db.instance.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...values);
      }

      // Additive: assigns these categories to each task without removing
      // existing assignments. Use the per-task `updateTask` for replace-all.
      if (input.categoryIds !== undefined) {
        const insertCat = db.instance.prepare(
          'INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)'
        );
        for (const catId of input.categoryIds) {
          insertCat.run(id, catId);
        }
      }
    }
  });
  transaction();
  return { updatedCount: ids.length };
}

export function batchSoftDeleteTasks(db: Database, ids: string[]): { deletedCount: number } {
  const stmt = db.instance.prepare(
    "UPDATE tasks SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL"
  );
  const transaction = db.instance.transaction(() => {
    let count = 0;
    for (const id of ids) {
      const result = stmt.run(id);
      count += result.changes;
    }
    return count;
  });
  const deletedCount = transaction();
  return { deletedCount };
}

export function getDeletedTasks(db: Database, params?: PaginationParams): PaginatedResponse<Task> {
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 50;
  const rows = db.instance
    .prepare(
      `SELECT * FROM tasks WHERE deleted_at IS NOT NULL
       ORDER BY deleted_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as TaskRow[];
  const countRow = db.instance
    .prepare('SELECT COUNT(*) as total FROM tasks WHERE deleted_at IS NOT NULL')
    .get() as { total: number };
  const items = rows.map((row) => rowToTask(db, row));
  return {
    items,
    total: countRow.total,
    offset,
    limit,
    hasMore: offset + items.length < countRow.total,
  };
}

export function restoreTask(db: Database, id: string): Task {
  id = resolveTaskId(db, id);
  db.instance
    .prepare("UPDATE tasks SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NOT NULL")
    .run(id);
  const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  return rowToTask(db, row);
}

export function batchRestoreTasks(db: Database, ids: string[]): { restoredCount: number } {
  const stmt = db.instance.prepare(
    "UPDATE tasks SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NOT NULL"
  );
  const transaction = db.instance.transaction(() => {
    let count = 0;
    for (const id of ids) {
      const result = stmt.run(id);
      count += result.changes;
    }
    return count;
  });
  const restoredCount = transaction();
  return { restoredCount };
}

export function purgeDeletedTask(db: Database, id: string): void {
  id = resolveTaskId(db, id);
  db.instance
    .prepare('DELETE FROM tasks WHERE id = ? AND deleted_at IS NOT NULL')
    .run(id);
}

export function emptyRecycleBin(db: Database): void {
  db.instance
    .prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL')
    .run();
}

export function restoreAllDeleted(db: Database): { restoredCount: number } {
  const result = db.instance
    .prepare("UPDATE tasks SET deleted_at = NULL, updated_at = datetime('now') WHERE deleted_at IS NOT NULL")
    .run();
  return { restoredCount: result.changes };
}

export function deleteAllTasks(db: Database): { deletedCount: number } {
  const result = db.instance
    .prepare("UPDATE tasks SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE deleted_at IS NULL")
    .run();
  return { deletedCount: result.changes };
}

/**
 * Upsert a task by (plugin_id, external_id). Insert if not found, otherwise
 * update mirror fields.
 *
 * Title/notes/description/status are overwritten only for full mirrors
 * (source='plugin'), where the plugin owns them. Link-only tasks keep their
 * user-authored values; see the comment on `isFullMirror` below.
 *
 * Status is additionally gated on state_dirty=0; if state_dirty=1 a local push
 * is pending and we must not clobber it.
 */
export function upsertExternalTask(db: Database, input: UpsertExternalTaskInput): Task {
  if (!input.pluginId) {
    throw new DomainError('VALIDATION_ERROR', 'upsertExternal: pluginId is required');
  }
  const now = new Date().toISOString();
  const existing = db.instance
    .prepare('SELECT id, state_dirty, source FROM tasks WHERE plugin_id = ? AND external_id = ?')
    .get(input.pluginId, input.externalId) as
    | { id: string; state_dirty: number; source: string }
    | undefined;

  if (!existing) {
    const id = uuidv4();
    const maxOrder = db.instance
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM tasks')
      .get() as { next: number };
    db.instance
      .prepare(
        `INSERT INTO tasks (
          id, title, description, status, source, external_id, plugin_id,
          sort_order, notes, external_url, external_state,
          external_completed_hours, external_refreshed_at, state_dirty,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'plugin', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.description ?? '',
        input.status ?? 'todo',
        input.externalId,
        input.pluginId,
        maxOrder.next,
        input.notes ?? '',
        input.externalUrl ?? null,
        input.externalState ?? null,
        input.externalCompletedHours ?? null,
        input.externalRefreshedAt ?? now,
        now,
        now,
      );
    const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
    return rowToTask(db, row);
  }

  // Link-only tasks (`linkTaskToPlugin` mode='link') keep source='ad-hoc' and
  // are documented as user-owned: "Title/notes remain user-editable ... does
  // not pull state into ct." Only full mirrors (source='plugin') may have
  // their user-facing columns rewritten by a pull. The remote metadata columns
  // below are still refreshed for both, since those describe the work item
  // rather than the ct task.
  //
  // Note this must stay a column-level skip. Adding `AND source = 'plugin'` to
  // the lookup above would instead miss the row and fall into the INSERT
  // branch, duplicating (plugin_id, external_id) into the partial unique index
  // from migration 007.
  const isFullMirror = existing.source === 'plugin';

  const sets: string[] = [];
  const values: unknown[] = [];

  if (isFullMirror) {
    sets.push('title = ?', 'notes = ?', 'description = ?');
    values.push(input.title, input.notes ?? '', input.description ?? '');
  }

  if (input.externalUrl !== undefined) {
    sets.push('external_url = ?');
    values.push(input.externalUrl);
  }
  if (input.externalState !== undefined) {
    sets.push('external_state = ?');
    values.push(input.externalState);
  }
  if (input.externalCompletedHours !== undefined) {
    sets.push('external_completed_hours = ?');
    values.push(input.externalCompletedHours);
  }
  sets.push('external_refreshed_at = ?');
  values.push(input.externalRefreshedAt ?? now);

  if (isFullMirror && input.status !== undefined && existing.state_dirty === 0) {
    sets.push('status = ?');
    values.push(input.status);
  }

  sets.push("updated_at = datetime('now')");
  values.push(existing.id);
  db.instance.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ?').get(existing.id) as TaskRow;
  return rowToTask(db, row);
}

/**
 * Record the external state a plugin just pushed, and clear `state_dirty`.
 *
 * `pushedStatus` is the ct status the plugin actually pushed. When given, the
 * flag is cleared only if the task still has that status: if the user changed
 * it again while the push was in flight, their change is still unpushed, and
 * clearing the flag would drop it silently — the next pull would see a clean
 * task and revert ct to what ADO holds. `external_state` is recorded either
 * way, because ADO really is in that state.
 *
 * Omitting `pushedStatus` keeps the old clear-unconditionally behavior, so an
 * already-packaged plugin that doesn't send it still works. The check is
 * `!= null`, not `!== undefined`, because omitting it over HTTP does not
 * arrive as `undefined`: `CtClient` sends a positional `[id, state, undefined]`
 * array, and `JSON.stringify` turns a trailing `undefined` into `null`. An
 * `!== undefined` check would treat that as "a status was pushed", compare it
 * against the real status, and leave `state_dirty` set forever — the exact
 * opposite of the back-compat this promises.
 *
 * The read and the write share one transaction: a status change landing
 * between them would otherwise be lost the same way, just through a much
 * narrower window.
 */
export function setExternalTaskState(
  db: Database,
  id: string,
  externalState: string,
  // `null` is reachable: see the note above on JSON transport.
  pushedStatus?: string | null,
): { ok: true; stillDirty: boolean } {
  id = resolveTaskId(db, id);

  const raced = db.instance.transaction(() => {
    const current = db.instance
      .prepare('SELECT status FROM tasks WHERE id = ?')
      .get(id) as { status: string } | undefined;
    if (!current) throw new DomainError('NOT_FOUND', `Task not found: ${id}`, 404);

    const stillDirty = pushedStatus != null && current.status !== pushedStatus;

    db.instance
      .prepare(
        `UPDATE tasks SET external_state = ?, state_dirty = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(externalState, stillDirty ? 1 : 0, id);

    return stillDirty;
  })() as boolean;

  return { ok: true, stillDirty: raced };
}

/**
 * Manually link an existing task to a remote ticket served by `pluginId`.
 *
 * - `mode='link'` — store `plugin_id` and `external_id` only. `source` stays
 *   whatever it was (typically `ad-hoc`). Title/notes remain user-editable.
 *   The plugin can push time/comments using the external id but does not pull
 *   state into ct.
 * - `mode='mirror'` — additionally set `source='plugin'`. The task becomes a
 *   full mirror: the renderer locks title/notes, the FSM applies, and the
 *   next pull will refresh state from the remote.
 *
 * Throws a DomainError if the plugin is missing/disabled, the externalId is
 * empty, or another task already holds that external id, so the caller can
 * surface a clear message.
 */
export function linkTaskToPlugin(
  db: Database,
  taskId: string,
  input: LinkTaskInput,
): Task {
  const externalId = input.externalId.trim();
  if (!externalId) {
    throw new DomainError('VALIDATION_ERROR', 'externalId must be a non-empty string');
  }
  const plugin = db.instance
    .prepare('SELECT id, enabled FROM plugins WHERE id = ?')
    .get(input.pluginId) as { id: string; enabled: number } | undefined;
  if (!plugin) {
    throw new DomainError('NOT_FOUND', `Plugin not found: ${input.pluginId}`);
  }
  if (plugin.enabled !== 1) {
    throw new DomainError('VALIDATION_ERROR', `Plugin "${input.pluginId}" is disabled`);
  }

  const resolvedId = resolveTaskId(db, taskId);

  // Two partial unique indexes cover external_id: (plugin_id, external_id)
  // from migration 009 and (source, external_id) from 007. Neither excludes
  // soft-deleted rows, so a task sitting in the recycle bin still holds its
  // external id and still collides. Check both pairs -- and check them
  // against the source this link will leave the task with, which is 'plugin'
  // in mirror mode -- so the user gets a message naming the other task
  // instead of a raw SQLite "UNIQUE constraint failed".
  const newSource = input.mode === 'mirror'
    ? 'plugin'
    : (db.instance.prepare('SELECT source FROM tasks WHERE id = ?').get(resolvedId) as
        { source: string } | undefined)?.source;
  const conflict = db.instance
    .prepare(
      `SELECT id, title, deleted_at FROM tasks
       WHERE id != ? AND external_id = ?
         AND (plugin_id = ? OR source = ?)
       LIMIT 1`,
    )
    .get(resolvedId, externalId, input.pluginId, newSource ?? null) as
      { id: string; title: string; deleted_at: string | null } | undefined;
  if (conflict) {
    const where = conflict.deleted_at ? ' (in the recycle bin)' : '';
    throw new DomainError(
      'CONFLICT',
      `External id "${externalId}" is already linked to task "${conflict.title}"${where}. ` +
        'Unlink that task first.',
      409,
    );
  }

  const sets: string[] = ['plugin_id = ?', 'external_id = ?'];
  const values: unknown[] = [input.pluginId, externalId];
  if (input.mode === 'mirror') {
    sets.push("source = 'plugin'");
  }
  sets.push("updated_at = datetime('now')");
  values.push(resolvedId);
  db.instance.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ?').get(resolvedId) as TaskRow | undefined;
  if (!row) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);
  return rowToTask(db, row);
}

/**
 * Reverse of `linkTaskToPlugin`. Always clears `plugin_id` and `external_id`.
 * For tasks that were full-mirror (source != 'manual'), also resets the
 * mirrored state columns and source back to `manual` so the task behaves
 * like any other local task.
 */
export function unlinkTaskFromPlugin(db: Database, taskId: string): Task {
  const resolvedId = resolveTaskId(db, taskId);
  const current = db.instance
    .prepare('SELECT source FROM tasks WHERE id = ?')
    .get(resolvedId) as { source: string } | undefined;
  if (!current) throw new DomainError('NOT_FOUND', `Task not found: ${taskId}`);

  const sets: string[] = ['plugin_id = NULL', 'external_id = NULL'];
  // Full-mirror tasks (source='plugin') restore back to 'ad-hoc' and clear
  // the mirrored columns so the task behaves like any locally-created task.
  if (current.source === 'plugin') {
    sets.push(
      "source = 'ad-hoc'",
      'external_url = NULL',
      'external_state = NULL',
      'external_completed_hours = NULL',
      'external_refreshed_at = NULL',
      'state_dirty = 0',
    );
  }
  sets.push("updated_at = datetime('now')");
  db.instance.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(resolvedId);

  const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ?').get(resolvedId) as TaskRow;
  return rowToTask(db, row);
}

export function resetApp(db: Database): void {
  db.instance.transaction(() => {
    db.instance.prepare('DELETE FROM task_categories').run();
    db.instance.prepare('DELETE FROM time_entries').run();
    db.instance.prepare('DELETE FROM comments').run();
    db.instance.prepare('DELETE FROM tasks').run();
    db.instance.prepare('DELETE FROM categories').run();
  })();
}

// ─── IPC registration (thin wrappers around exported functions) ─────

export function registerTaskHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('tasks:getAll', () => getAllTasks(db));
  ipcMain.handle('tasks:getById', (_event, id: string) => getTaskById(db, id));
  ipcMain.handle('tasks:getActive', (_event, params?: TaskQueryParams) => getActiveTasks(db, params));
  ipcMain.handle('tasks:getActiveIds', (_event, params?: TaskQueryParams) => getActiveTaskIds(db, params));
  ipcMain.handle('tasks:getDone', (_event, params?: TaskQueryParams) => getDoneTasks(db, params));
  ipcMain.handle('tasks:create', (_event, input: CreateTaskInput) => createTask(db, input));
  ipcMain.handle('tasks:update', (_event, id: string, updates: UpdateTaskInput) => updateTask(db, id, updates));
  ipcMain.handle('tasks:delete', (_event, id: string) => deleteTask(db, id));
  ipcMain.handle('tasks:reorder', (_event, orderedIds: string[]) => reorderTasks(db, orderedIds));
  ipcMain.handle('tasks:batchUpdate', (_event, ids: string[], input: BatchUpdateInput) => batchUpdateTasks(db, ids, input));
  ipcMain.handle('tasks:batchSoftDelete', (_event, ids: string[]) => batchSoftDeleteTasks(db, ids));
  ipcMain.handle('tasks:getDeleted', (_event, params?: PaginationParams) => getDeletedTasks(db, params));
  ipcMain.handle('tasks:restore', (_event, id: string) => restoreTask(db, id));
  ipcMain.handle('tasks:batchRestore', (_event, ids: string[]) => batchRestoreTasks(db, ids));
  ipcMain.handle('tasks:purgeDeleted', (_event, id: string) => purgeDeletedTask(db, id));
  ipcMain.handle('tasks:emptyRecycleBin', () => emptyRecycleBin(db));
  ipcMain.handle('tasks:restoreAll', () => restoreAllDeleted(db));
  ipcMain.handle('tasks:deleteAll', () => deleteAllTasks(db));
  ipcMain.handle('tasks:resetApp', () => resetApp(db));
  ipcMain.handle('tasks:upsertExternal', (_event, input: UpsertExternalTaskInput) => upsertExternalTask(db, input));
  ipcMain.handle('tasks:setExternalState', (_event, id: string, externalState: string, pushedStatus?: string | null) => setExternalTaskState(db, id, externalState, pushedStatus));
  ipcMain.handle(
    'tasks:link',
    (_event, id: string, input: LinkTaskInput) =>
      linkTaskToPlugin(db, id, input),
  );
  ipcMain.handle('tasks:unlink', (_event, id: string) => unlinkTaskFromPlugin(db, id));
}
