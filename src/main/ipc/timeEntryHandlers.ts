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
    // Singleton timer: stop any currently active entry first
    const active = db.instance
      .prepare('SELECT * FROM time_entries WHERE end_time IS NULL')
      .get() as TimeEntryRow | undefined;

    if (active) {
      const duration = Math.floor(
        (Date.now() - new Date(active.start_time).getTime()) / 1000
      );
      db.instance
        .prepare(
          "UPDATE time_entries SET end_time = datetime('now'), duration_seconds = ? WHERE id = ?"
        )
        .run(duration, active.id);
    }

    const id = uuidv4();
    const now = new Date().toISOString();

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
        null,
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

  ipcMain.handle('timeEntries:stopActive', () => {
    const active = db.instance
      .prepare('SELECT * FROM time_entries WHERE end_time IS NULL')
      .get() as TimeEntryRow | undefined;

    if (!active) return null;

    const duration = Math.floor(
      (Date.now() - new Date(active.start_time).getTime()) / 1000
    );
    db.instance
      .prepare(
        "UPDATE time_entries SET end_time = datetime('now'), duration_seconds = ? WHERE id = ?"
      )
      .run(duration, active.id);

    const row = db.instance.prepare('SELECT * FROM time_entries WHERE id = ?').get(active.id) as TimeEntryRow;
    return rowToTimeEntry(row);
  });
}
