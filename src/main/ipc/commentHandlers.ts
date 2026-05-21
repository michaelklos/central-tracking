import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { Comment, CreateCommentInput, PendingSyncComment, TaskSource, UpdateCommentInput, UpsertExternalCommentInput } from '../../shared/types';

interface CommentRow {
  id: string;
  task_id: string;
  body: string;
  syncable: number;
  synced: number;
  external_id: string | null;
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
    externalId: row.external_id,
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
  if (updates.externalId !== undefined) {
    sets.push('external_id = ?');
    values.push(updates.externalId);
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

/**
 * Outbound comments awaiting push to an external system. Joins to tasks so
 * the plugin gets the work-item id and source in one query and doesn't have
 * to fetch every task to figure out which comments to push.
 *
 * Filter is parameterized by owning plugin id (e.g. 'ado') so future plugins
 * can share the route.
 */
export function getPendingSyncComments(
  db: Database,
  pluginId: string,
): PendingSyncComment[] {
  const rows = db.instance
    .prepare(
      `SELECT c.id, c.task_id, c.body, c.syncable, c.synced, c.external_id,
              c.created_at, c.updated_at,
              t.source AS task_source, t.external_id AS task_external_id
       FROM comments c
       JOIN tasks t ON t.id = c.task_id
       WHERE t.plugin_id = ? AND c.syncable = 1 AND c.synced = 0
       ORDER BY c.created_at ASC`,
    )
    .all(pluginId) as Array<
      CommentRow & { task_source: string; task_external_id: string | null }
    >;
  return rows.map((r) => ({
    ...rowToComment(r),
    taskSource: r.task_source as TaskSource,
    taskExternalId: r.task_external_id,
  }));
}

/**
 * Upsert a comment by external_id. Mirrored external comments are always
 * `synced=1, syncable=0` — they're read-only mirrors of the source-of-truth
 * system. Insert on first sight; update body on subsequent pulls.
 */
export function upsertExternalComment(
  db: Database,
  input: UpsertExternalCommentInput,
): Comment {
  const now = new Date().toISOString();
  const existing = db.instance
    .prepare('SELECT id FROM comments WHERE external_id = ?')
    .get(input.externalId) as { id: string } | undefined;

  if (!existing) {
    const id = uuidv4();
    db.instance
      .prepare(
        `INSERT INTO comments (id, task_id, body, syncable, synced, external_id, created_at, updated_at)
         VALUES (?, ?, ?, 0, 1, ?, ?, ?)`,
      )
      .run(id, input.taskId, input.body, input.externalId, now, now);
    const row = db.instance.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRow;
    return rowToComment(row);
  }

  db.instance
    .prepare("UPDATE comments SET body = ?, updated_at = datetime('now') WHERE id = ?")
    .run(input.body, existing.id);
  const row = db.instance.prepare('SELECT * FROM comments WHERE id = ?').get(existing.id) as CommentRow;
  return rowToComment(row);
}

// ─── IPC registration (thin wrappers around exported functions) ─────

export function registerCommentHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('comments:getByTask', (_event, taskId: string) => getCommentsByTask(db, taskId));
  ipcMain.handle('comments:create', (_event, input: CreateCommentInput) => createComment(db, input));
  ipcMain.handle('comments:update', (_event, id: string, updates: UpdateCommentInput) => updateComment(db, id, updates));
  ipcMain.handle('comments:delete', (_event, id: string) => deleteComment(db, id));
  ipcMain.handle('comments:upsertExternal', (_event, input: UpsertExternalCommentInput) => upsertExternalComment(db, input));
  ipcMain.handle('comments:getPendingSync', (_event, pluginId: string) => getPendingSyncComments(db, pluginId));
}
