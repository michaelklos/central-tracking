import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { CreateTaskInput, Task, UpdateTaskInput, PaginationParams, PaginatedResponse } from '../../shared/types';

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
      ), 0) as total FROM time_entries WHERE task_id = ? AND date(start_time) = date('now')`
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerTaskHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('tasks:getAll', () => {
    const rows = db.instance
      .prepare('SELECT * FROM tasks ORDER BY sort_order ASC, created_at DESC')
      .all() as TaskRow[];
    return rows.map((row) => rowToTask(db, row));
  });

  ipcMain.handle('tasks:getById', (_event, id: string) => {
    const row = db.instance.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | TaskRow
      | undefined;
    return row ? rowToTask(db, row) : null;
  });

  ipcMain.handle('tasks:getActive', (_event, params?: PaginationParams): PaginatedResponse<Task> => {
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 50;
    const rows = db.instance
      .prepare(
        `SELECT * FROM tasks WHERE status != 'done'
         ORDER BY sort_order ASC, created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as TaskRow[];
    const countRow = db.instance
      .prepare("SELECT COUNT(*) as total FROM tasks WHERE status != 'done'")
      .get() as { total: number };
    const items = rows.map((row) => rowToTask(db, row));
    return {
      items,
      total: countRow.total,
      offset,
      limit,
      hasMore: offset + items.length < countRow.total,
    };
  });

  ipcMain.handle('tasks:getDone', (_event, params?: PaginationParams): PaginatedResponse<Task> => {
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 50;
    const rows = db.instance
      .prepare(
        `SELECT * FROM tasks WHERE status = 'done'
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as TaskRow[];
    const countRow = db.instance
      .prepare("SELECT COUNT(*) as total FROM tasks WHERE status = 'done'")
      .get() as { total: number };
    const items = rows.map((row) => rowToTask(db, row));
    return {
      items,
      total: countRow.total,
      offset,
      limit,
      hasMore: offset + items.length < countRow.total,
    };
  });

  ipcMain.handle('tasks:create', (_event, input: CreateTaskInput) => {
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
  });

  ipcMain.handle('tasks:update', (_event, id: string, updates: UpdateTaskInput) => {
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
  });

  ipcMain.handle('tasks:delete', (_event, id: string) => {
    db.instance.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  });

  ipcMain.handle('tasks:reorder', (_event, orderedIds: string[]) => {
    const update = db.instance.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
    const transaction = db.instance.transaction(() => {
      orderedIds.forEach((id, index) => {
        update.run(index, id);
      });
    });
    transaction();
  });
}
