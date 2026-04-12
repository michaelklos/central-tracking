import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { CreateTimeEntryInput, TimeEntry, UpdateTimeEntryInput, PaginationParams, PaginatedResponse, SummaryReportEntry, TimeEntryWithTask, TaskSource, TaskStatus } from '../../shared/types';

interface TimeEntryRow {
  id: string;
  task_id: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  note: string;
  created_at: string;
}

function rowToTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    startTime: row.start_time,
    endTime: row.end_time,
    durationSeconds: row.duration_seconds,
    note: row.note,
    createdAt: row.created_at,
  };
}

// ─── Exported handler functions (used by both IPC and HTTP server) ───

export function getTimeEntriesByTask(db: Database, taskId: string): TimeEntry[] {
  const rows = db.instance
    .prepare('SELECT * FROM time_entries WHERE task_id = ? ORDER BY start_time DESC')
    .all(taskId) as TimeEntryRow[];
  return rows.map(rowToTimeEntry);
}

export function getTimeEntriesByTaskPaginated(db: Database, taskId: string, params?: PaginationParams): PaginatedResponse<TimeEntry> {
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 20;
  const rows = db.instance
    .prepare(
      'SELECT * FROM time_entries WHERE task_id = ? ORDER BY start_time DESC LIMIT ? OFFSET ?'
    )
    .all(taskId, limit, offset) as TimeEntryRow[];
  const countRow = db.instance
    .prepare('SELECT COUNT(*) as total FROM time_entries WHERE task_id = ?')
    .get(taskId) as { total: number };
  const items = rows.map(rowToTimeEntry);
  return {
    items,
    total: countRow.total,
    offset,
    limit,
    hasMore: offset + items.length < countRow.total,
  };
}

export function createTimeEntry(db: Database, input: CreateTimeEntryInput): TimeEntry {
  const isManualEntry = input.endTime != null;

  // Singleton timer: stop any currently active entry first
  // But only if this is NOT a manual (completed) entry
  if (!isManualEntry) {
    const active = db.instance
      .prepare('SELECT * FROM time_entries WHERE end_time IS NULL')
      .get() as TimeEntryRow | undefined;

    if (active) {
      const stopNow = new Date().toISOString();
      const duration = Math.floor(
        (new Date(stopNow).getTime() - new Date(active.start_time).getTime()) / 1000
      );
      db.instance
        .prepare(
          'UPDATE time_entries SET end_time = ?, duration_seconds = ? WHERE id = ?'
        )
        .run(stopNow, duration, active.id);
    }
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  // Calculate duration for manual entries
  let durationSeconds: number | null = null;
  if (isManualEntry) {
    const startMs = new Date(input.startTime ?? now).getTime();
    const endMs = new Date(input.endTime!).getTime();
    durationSeconds = Math.floor((endMs - startMs) / 1000);
  }

  db.instance
    .prepare(
      `INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.taskId,
      input.startTime ?? now,
      input.endTime ?? null,
      durationSeconds,
      input.note ?? '',
      now
    );

  const row = db.instance.prepare('SELECT * FROM time_entries WHERE id = ?').get(id) as TimeEntryRow;
  return rowToTimeEntry(row);
}

export function updateTimeEntry(db: Database, id: string, updates: UpdateTimeEntryInput): TimeEntry {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.startTime !== undefined) {
    sets.push('start_time = ?');
    values.push(updates.startTime);
  }
  if (updates.endTime !== undefined) {
    sets.push('end_time = ?');
    values.push(updates.endTime);
  }
  if (updates.note !== undefined) {
    sets.push('note = ?');
    values.push(updates.note);
  }

  if (sets.length > 0) {
    values.push(id);
    db.instance.prepare(`UPDATE time_entries SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  // Recalculate duration if both start and end are set
  const row = db.instance.prepare('SELECT * FROM time_entries WHERE id = ?').get(id) as TimeEntryRow;
  if (row.start_time && row.end_time) {
    const duration = Math.floor(
      (new Date(row.end_time).getTime() - new Date(row.start_time).getTime()) / 1000
    );
    db.instance.prepare('UPDATE time_entries SET duration_seconds = ? WHERE id = ?').run(duration, id);
  }

  const updated = db.instance.prepare('SELECT * FROM time_entries WHERE id = ?').get(id) as TimeEntryRow;
  return rowToTimeEntry(updated);
}

export function deleteTimeEntry(db: Database, id: string): void {
  db.instance.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
}

export function getActiveTimeEntry(db: Database): TimeEntry | null {
  const row = db.instance
    .prepare('SELECT * FROM time_entries WHERE end_time IS NULL LIMIT 1')
    .get() as TimeEntryRow | undefined;
  return row ? rowToTimeEntry(row) : null;
}

export function getTodayTotal(db: Database): number {
  const row = db.instance
    .prepare(
      `SELECT COALESCE(SUM(
        CASE WHEN end_time IS NOT NULL
          THEN CAST((julianday(end_time) - julianday(start_time)) * 86400 AS INTEGER)
          ELSE CAST((julianday('now') - julianday(start_time)) * 86400 AS INTEGER)
        END
      ), 0) as total FROM time_entries WHERE date(start_time) = date('now')`
    )
    .get() as { total: number };
  return row.total;
}

export function getTimeEntriesByDateRange(db: Database, start: string, end: string): TimeEntry[] {
  const rows = db.instance
    .prepare(
      'SELECT * FROM time_entries WHERE start_time >= ? AND start_time <= ? ORDER BY start_time DESC'
    )
    .all(start, end) as TimeEntryRow[];
  return rows.map(rowToTimeEntry);
}

export function getTimeEntryReport(db: Database, start: string, end: string) {
  const rows = db.instance
    .prepare(
      `SELECT
        date(te.start_time) as date,
        te.task_id,
        t.title as task_title,
        COALESCE(SUM(
          CASE WHEN te.end_time IS NOT NULL
            THEN CAST((julianday(te.end_time) - julianday(te.start_time)) * 86400 AS INTEGER)
            ELSE CAST((julianday('now') - julianday(te.start_time)) * 86400 AS INTEGER)
          END
        ), 0) as total_seconds
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      WHERE te.start_time >= ? AND te.start_time <= ?
      GROUP BY date(te.start_time), te.task_id
      ORDER BY date(te.start_time)`
    )
    .all(start, end) as { date: string; task_id: string; task_title: string; total_seconds: number }[];
  return rows.map((r) => ({
    date: r.date,
    taskId: r.task_id,
    taskTitle: r.task_title,
    totalSeconds: r.total_seconds,
  }));
}

export function getSummaryReport(db: Database, start: string, end: string): SummaryReportEntry[] {
  const rows = db.instance
    .prepare(
      `SELECT
        date(te.start_time) as date,
        te.task_id,
        t.title as task_title,
        t.source as task_source,
        t.status as task_status,
        COALESCE(SUM(
          CASE WHEN te.end_time IS NOT NULL
            THEN CAST((julianday(te.end_time) - julianday(te.start_time)) * 86400 AS INTEGER)
            ELSE CAST((julianday('now') - julianday(te.start_time)) * 86400 AS INTEGER)
          END
        ), 0) as total_seconds
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      WHERE te.start_time >= ? AND te.start_time <= ? AND t.deleted_at IS NULL
      GROUP BY date(te.start_time), te.task_id
      ORDER BY date(te.start_time)`
    )
    .all(start, end) as { date: string; task_id: string; task_title: string; task_source: string; task_status: string; total_seconds: number }[];

  // Batch-fetch category IDs for all unique task IDs
  const taskIds = [...new Set(rows.map((r) => r.task_id))];
  const categoryMap: Record<string, string[]> = {};
  for (const taskId of taskIds) {
    const cats = db.instance
      .prepare('SELECT category_id FROM task_categories WHERE task_id = ?')
      .all(taskId) as { category_id: string }[];
    categoryMap[taskId] = cats.map((c) => c.category_id);
  }

  return rows.map((r): SummaryReportEntry => ({
    date: r.date,
    taskId: r.task_id,
    taskTitle: r.task_title,
    taskSource: r.task_source as TaskSource,
    taskStatus: r.task_status as TaskStatus,
    categoryIds: categoryMap[r.task_id] ?? [],
    totalSeconds: r.total_seconds,
  }));
}

export function getTimeEntriesByDateRangeWithTasks(db: Database, start: string, end: string): TimeEntryWithTask[] {
  const rows = db.instance
    .prepare(
      `SELECT te.*, t.title as task_title, t.source as task_source
      FROM time_entries te
      JOIN tasks t ON t.id = te.task_id
      WHERE te.start_time >= ? AND te.start_time <= ? AND t.deleted_at IS NULL
      ORDER BY te.start_time ASC`
    )
    .all(start, end) as (TimeEntryRow & { task_title: string; task_source: string })[];

  return rows.map((r): TimeEntryWithTask => ({
    ...rowToTimeEntry(r),
    taskTitle: r.task_title,
    taskSource: r.task_source as TaskSource,
  }));
}

export function stopActiveTimeEntry(db: Database): TimeEntry | null {
  const active = db.instance
    .prepare('SELECT * FROM time_entries WHERE end_time IS NULL')
    .get() as TimeEntryRow | undefined;

  if (!active) return null;

  const stopNow = new Date().toISOString();
  const duration = Math.floor(
    (new Date(stopNow).getTime() - new Date(active.start_time).getTime()) / 1000
  );
  db.instance
    .prepare(
      'UPDATE time_entries SET end_time = ?, duration_seconds = ? WHERE id = ?'
    )
    .run(stopNow, duration, active.id);

  const row = db.instance.prepare('SELECT * FROM time_entries WHERE id = ?').get(active.id) as TimeEntryRow;
  return rowToTimeEntry(row);
}

// ─── IPC registration (thin wrappers around exported functions) ─────

export function registerTimeEntryHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('timeEntries:getByTask', (_event, taskId: string) => getTimeEntriesByTask(db, taskId));
  ipcMain.handle('timeEntries:getByTaskPaginated', (_event, taskId: string, params?: PaginationParams) => getTimeEntriesByTaskPaginated(db, taskId, params));
  ipcMain.handle('timeEntries:create', (_event, input: CreateTimeEntryInput) => createTimeEntry(db, input));
  ipcMain.handle('timeEntries:update', (_event, id: string, updates: UpdateTimeEntryInput) => updateTimeEntry(db, id, updates));
  ipcMain.handle('timeEntries:delete', (_event, id: string) => deleteTimeEntry(db, id));
  ipcMain.handle('timeEntries:getActive', () => getActiveTimeEntry(db));
  ipcMain.handle('timeEntries:getTodayTotal', () => getTodayTotal(db));
  ipcMain.handle('timeEntries:getByDateRange', (_event, start: string, end: string) => getTimeEntriesByDateRange(db, start, end));
  ipcMain.handle('timeEntries:getReport', (_event, start: string, end: string) => getTimeEntryReport(db, start, end));
  ipcMain.handle('timeEntries:getSummaryReport', (_event, start: string, end: string) => getSummaryReport(db, start, end));
  ipcMain.handle('timeEntries:getByDateRangeWithTasks', (_event, start: string, end: string) => getTimeEntriesByDateRangeWithTasks(db, start, end));
  ipcMain.handle('timeEntries:stopActive', () => stopActiveTimeEntry(db));
}
