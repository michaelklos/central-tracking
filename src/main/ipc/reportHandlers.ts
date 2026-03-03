import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import * as fs from 'fs';
import type { Database } from '../database/database';

interface TimeEntryRow {
  id: string;
  task_id: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  note: string;
  created_at: string;
}

interface TaskRow {
  title: string;
}

export function registerReportHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('reports:exportCsv', async (_event, start: string, end: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Time Report',
      defaultPath: 'time-report.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (result.canceled || !result.filePath) return null;

    const rows = db.instance
      .prepare(
        `SELECT te.*, t.title as task_title
         FROM time_entries te
         JOIN tasks t ON t.id = te.task_id
         WHERE te.start_time >= ? AND te.start_time <= ?
         ORDER BY te.start_time`
      )
      .all(start, end) as (TimeEntryRow & { task_title: string })[];

    const lines = ['Date,Task,Start,End,Duration,Note'];
    for (const row of rows) {
      const date = row.start_time.split('T')[0];
      const startTime = row.start_time;
      const endTime = row.end_time ?? '';
      const duration = row.duration_seconds ?? 0;
      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);
      const durationStr = `${hours}h ${minutes}m`;
      const note = row.note.replace(/"/g, '""');
      const title = row.task_title.replace(/"/g, '""');

      lines.push(`${date},"${title}",${startTime},${endTime},${durationStr},"${note}"`);
    }

    fs.writeFileSync(result.filePath, lines.join('\n'), 'utf-8');
    return result.filePath;
  });
}
