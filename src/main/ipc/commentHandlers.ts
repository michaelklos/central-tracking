import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { Comment, CreateCommentInput, UpdateCommentInput } from '../../shared/types';

interface CommentRow {
  id: string;
  task_id: string;
  body: string;
  syncable: number;
  synced: number;
  created_at: string;
  updated_at: string;
}

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    body: row.body,
    syncable: row.syncable === 1,
    synced: row.synced === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Exported handler functions (used by both IPC and HTTP server) ───

export function getCommentsByTask(db: Database, taskId: string): Comment[] {
  const rows = db.instance
    .prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at DESC')
    .all(taskId) as CommentRow[];
  return rows.map(rowToComment);
}

export function createComment(db: Database, input: CreateCommentInput): Comment {
  const id = uuidv4();
  const now = new Date().toISOString();

  db.instance
    .prepare(
      `INSERT INTO comments (id, task_id, body, syncable, synced, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    .run(id, input.taskId, input.body, input.syncable ? 1 : 0, now, now);

  const row = db.instance.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRow;
  return rowToComment(row);
}

export function updateComment(db: Database, id: string, updates: UpdateCommentInput): Comment {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.body !== undefined) {
    sets.push('body = ?');
    values.push(updates.body);
  }
  if (updates.syncable !== undefined) {
    sets.push('syncable = ?');
    values.push(updates.syncable ? 1 : 0);
  }
  if (updates.synced !== undefined) {
    sets.push('synced = ?');
    values.push(updates.synced ? 1 : 0);
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    values.push(id);
    db.instance.prepare(`UPDATE comments SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = db.instance.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRow;
  return rowToComment(row);
}

export function deleteComment(db: Database, id: string): void {
  db.instance.prepare('DELETE FROM comments WHERE id = ?').run(id);
}

// ─── IPC registration (thin wrappers around exported functions) ─────

export function registerCommentHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('comments:getByTask', (_event, taskId: string) => getCommentsByTask(db, taskId));
  ipcMain.handle('comments:create', (_event, input: CreateCommentInput) => createComment(db, input));
  ipcMain.handle('comments:update', (_event, id: string, updates: UpdateCommentInput) => updateComment(db, id, updates));
  ipcMain.handle('comments:delete', (_event, id: string) => deleteComment(db, id));
}
