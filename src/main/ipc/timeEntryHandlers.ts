import type { IpcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from '../database/database';
import type { CreateTimeEntryInput, TimeEntry, UpdateTimeEntryInput } from '../../shared/types';

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

export function registerTimeEntryHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('timeEntries:getByTask', (_event, taskId: string) => {
    const rows = db.instance
      .prepare('SELECT * FROM time_entries WHERE task_id = ? ORDER BY start_time DESC')
      .all(taskId) as TimeEntryRow[];
    return rows.map(rowToTimeEntry);
  });

  ipcMain.handle('timeEntries:create', (_event, input: CreateTimeEntryInput) => {
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
  });

  ipcMain.handle('timeEntries:update', (_event, id: string, updates: UpdateTimeEntryInput) => {
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
  });

  ipcMain.handle('timeEntries:delete', (_event, id: string) => {
    db.instance.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
  });

  ipcMain.handle('timeEntries:getActive', () => {
    const row = db.instance
      .prepare('SELECT * FROM time_entries WHERE end_time IS NULL LIMIT 1')
      .get() as TimeEntryRow | undefined;
    return row ? rowToTimeEntry(row) : null;
  });

  ipcMain.handle('timeEntries:getTodayTotal', () => {
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
  });

  ipcMain.handle('timeEntries:getByDateRange', (_event, start: string, end: string) => {
    const rows = db.instance
      .prepare(
        'SELECT * FROM time_entries WHERE start_time >= ? AND start_time <= ? ORDER BY start_time DESC'
      )
      .all(start, end) as TimeEntryRow[];
    return rows.map(rowToTimeEntry);
  });

  ipcMain.handle('timeEntries:getReport', (_event, start: string, end: string) => {
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
  });

  ipcMain.handle('timeEntries:stopActive', () => {
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
  });
}
