import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { Category, CreateCategoryInput, UpdateCategoryInput } from '../../shared/types';

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  };
}

// ─── Exported handler functions (used by both IPC and HTTP server) ───

export function getAllCategories(db: Database): Category[] {
  const rows = db.instance
    .prepare('SELECT * FROM categories ORDER BY name ASC')
    .all() as CategoryRow[];
  return rows.map(rowToCategory);
}

export function createCategory(db: Database, input: CreateCategoryInput): Category {
  const id = uuidv4();
  const now = new Date().toISOString();

  db.instance
    .prepare('INSERT INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .run(id, input.name, input.color ?? '#6b7280', now);

  const row = db.instance.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow;
  return rowToCategory(row);
}

export function updateCategory(db: Database, id: string, updates: UpdateCategoryInput): Category {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }
  if (updates.color !== undefined) {
    sets.push('color = ?');
    values.push(updates.color);
  }

  if (sets.length > 0) {
    values.push(id);
    db.instance.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = db.instance.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow;
  return rowToCategory(row);
}

export function deleteCategory(db: Database, id: string): void {
  db.instance.prepare('DELETE FROM task_categories WHERE category_id = ?').run(id);
  db.instance.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

export function assignCategoriesToTask(db: Database, taskId: string, categoryIds: string[]): void {
  db.instance.prepare('DELETE FROM task_categories WHERE task_id = ?').run(taskId);
  const insert = db.instance.prepare(
    'INSERT OR IGNORE INTO task_categories (task_id, category_id) VALUES (?, ?)'
  );
  const transaction = db.instance.transaction(() => {
    for (const catId of categoryIds) {
      insert.run(taskId, catId);
    }
  });
  transaction();
}

// ─── IPC registration (thin wrappers around exported functions) ─────

export function registerCategoryHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('categories:getAll', () => getAllCategories(db));
  ipcMain.handle('categories:create', (_event, input: CreateCategoryInput) => createCategory(db, input));
  ipcMain.handle('categories:update', (_event, id: string, updates: UpdateCategoryInput) => updateCategory(db, id, updates));
  ipcMain.handle('categories:delete', (_event, id: string) => deleteCategory(db, id));
  ipcMain.handle('categories:assignToTask', (_event, taskId: string, categoryIds: string[]) => assignCategoriesToTask(db, taskId, categoryIds));
}
