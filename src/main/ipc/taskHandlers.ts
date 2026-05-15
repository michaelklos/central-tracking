import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { CreateTaskInput, Task, UpdateTaskInput, BatchUpdateInput, PaginationParams, PaginatedResponse, TaskSortBy, TaskQueryParams } from '../../shared/types';

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
          THEN CAST((julianday(end_time) - julianday(start_time)) * 86400 AS INTEGER)
          ELSE CAST((julianday('now') - julianday(start_time)) * 86400 AS INTEGER)
        END
      ), 0) as total FROM time_entries WHERE task_id = ?`
    )
    .get(row.id) as { total: number };

  const todayTime = db.instance
    .prepare(
      `SELECT COALESCE(SUM(
        CASE WHEN end_time IS NOT NULL
          THEN CAST((julianday(end_time) - julianday(start_time)) * 86400 AS INTEGER)
          ELSE CAST((julianday('now') - julianday(start_time)) * 86400 AS INTEGER)
        END
      ), 0) as total FROM time_entries WHERE task_id = ? AND date(start_time, 'localtime') = date('now', 'localtime')`
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
    categoryIds: catRows.map((r) => r.category_id),
    notes: row.notes ?? '',
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
          THEN CAST((julianday(end_time) - julianday(start_time)) * 86400 AS INTEGER)
          ELSE CAST((julianday('now') - julianday(start_time)) * 86400 AS INTEGER)
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

  const categoryIds = toArray(params?.categoryId);
  if (categoryIds.length) {
    const placeholders = categoryIds.map(() => '?').join(', ');
    clauses.push(`id IN (SELECT task_id FROM task_categories WHERE category_id IN (${placeholders}))`);
    values.push(...categoryIds);
  }

  return { clauses, values };
}

function resolveTaskId(db: Database, id: string): string {
  // Full UUID — return as-is
  if (id.length >= 36) return id;

  // Try ID prefix match first
  const byId = db.instance
    .prepare("SELECT id FROM tasks WHERE id LIKE ?")
    .all(`${id}%`) as { id: string }[];
  if (byId.length === 1) return byId[0].id;
  if (byId.length > 1) throw new Error(`Ambiguous ID prefix "${id}" matches ${byId.length} tasks. Use more characters.`);

  // Fall back to case-insensitive title match
  const byTitle = db.instance
    .prepare("SELECT id FROM tasks WHERE title LIKE ? AND deleted_at IS NULL")
    .all(`%${id}%`) as { id: string }[];
  if (byTitle.length === 1) return byTitle[0].id;
  if (byTitle.length > 1) throw new Error(`Ambiguous name "${id}" matches ${byTitle.length} tasks. Be more specific.`);

  throw new Error(`Task not found: ${id}`);
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

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    values.push(id);
    db.instance.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  if (updates.categoryIds !== undefined) {
    db.instance.prepare('DELETE FROM task_categories WHERE task_id = ?').run(id);
    const insertCat = db.instance.prepare(
      'INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)'
    );
    for (const catId of updates.categoryIds) {
      insertCat.run(id, catId);
    }
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
}
