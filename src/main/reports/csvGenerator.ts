import type { Database } from '../database/database';
import { isoToLocalDateString, isoToLocalDateTimeString } from '../../shared/dateRange';

interface TimeEntryRow {
  id: string;
  task_id: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number | null;
  note: string;
  created_at: string;
}

export function generateCsvContent(db: Database, start: string, end: string): string {
  const rows = db.instance
    .prepare(
      `SELECT te.*, t.title as task_title
       FROM time_entries te
       JOIN tasks t ON t.id = te.task_id
       WHERE te.start_time >= ? AND te.start_time <= ?
         AND t.deleted_at IS NULL
       ORDER BY te.start_time`
    )
    .all(start, end) as (TimeEntryRow & { task_title: string })[];

  const lines = ['Date,Task,Start,End,Duration,Note'];
  for (const row of rows) {
    // Local calendar date, matching the range endpoints and the report
    // queries; splitting the ISO string would label it with the UTC date.
    const date = isoToLocalDateString(row.start_time);
    // Local wall-clock, so Start/End name the same day as the Date column.
    // They used to be raw UTC ISO, which after the Date column became local
    // made the file disagree with itself for any evening entry.
    const startTime = isoToLocalDateTimeString(row.start_time);
    const endTime = row.end_time ? isoToLocalDateTimeString(row.end_time) : '';
    const duration = row.duration_seconds ?? 0;
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const durationStr = `${hours}h ${minutes}m`;
    const note = row.note.replace(/"/g, '""');
    const title = row.task_title.replace(/"/g, '""');

    lines.push(`${date},"${title}",${startTime},${endTime},${durationStr},"${note}"`);
  }

  return lines.join('\n');
}
