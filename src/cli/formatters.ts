import { formatDurationHuman } from '../shared/duration';
import type { Task, TimeEntry, Comment, Category, SummaryReportEntry } from '../shared/types';

export { formatDurationHuman as formatDuration };

export function formatDate(isoString: string): string {
  return isoString.split('T')[0];
}

export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

export function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

export function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

type TaskRow = Pick<Task, 'id' | 'title' | 'status' | 'source' | 'totalTimeSeconds' | 'todayTimeSeconds'>;

export function formatTaskTable(tasks: TaskRow[], options?: { fullId?: boolean }): string {
  if (tasks.length === 0) return 'No tasks found.';

  const full = options?.fullId ?? false;
  const idWidth = full ? 38 : 10;
  const titleWidth = full ? 30 : 52;

  const rows = tasks.map((t) => ({
    id: full ? t.id : t.id.slice(0, 8),
    title: truncate(t.title, titleWidth - 2),
    status: t.status,
    source: t.source,
    today: formatDurationHuman(t.todayTimeSeconds),
    total: formatDurationHuman(t.totalTimeSeconds),
  }));

  const header = `${padRight('ID', idWidth)}${padRight('Title', titleWidth)}${padRight('Status', 14)}${padRight('Source', 12)}${padLeft('Today', 8)}${padLeft('Total', 8)}`;
  const separator = '-'.repeat(header.length);
  const lines = rows.map(
    (r) =>
      `${padRight(r.id, idWidth)}${padRight(r.title, titleWidth)}${padRight(r.status, 14)}${padRight(r.source, 12)}${padLeft(r.today, 8)}${padLeft(r.total, 8)}`
  );

  return [header, separator, ...lines].join('\n');
}

type TimeEntryRow = Pick<TimeEntry, 'id' | 'startTime' | 'endTime' | 'durationSeconds' | 'note'>;

export function formatTimeEntryTable(entries: TimeEntryRow[]): string {
  if (entries.length === 0) return 'No time entries found.';

  const rows = entries.map((e) => ({
    id: e.id.slice(0, 8),
    date: formatDate(e.startTime),
    start: formatTime(e.startTime),
    end: e.endTime ? formatTime(e.endTime) : 'running',
    duration: e.durationSeconds ? formatDurationHuman(e.durationSeconds) : '-',
    note: truncate(e.note || '-', 30),
  }));

  const header = `${padRight('ID', 10)}${padRight('Date', 12)}${padRight('Start', 8)}${padRight('End', 10)}${padLeft('Duration', 10)}  ${padRight('Note', 30)}`;
  const separator = '-'.repeat(header.length);
  const lines = rows.map(
    (r) =>
      `${padRight(r.id, 10)}${padRight(r.date, 12)}${padRight(r.start, 8)}${padRight(r.end, 10)}${padLeft(r.duration, 10)}  ${padRight(r.note, 30)}`
  );

  return [header, separator, ...lines].join('\n');
}

type SummaryRow = Pick<SummaryReportEntry, 'date' | 'taskTitle' | 'totalSeconds'>;

export function formatSummaryReport(entries: SummaryRow[]): string {
  if (entries.length === 0) return 'No time entries in this date range.';

  const byDate = new Map<string, SummaryRow[]>();
  for (const entry of entries) {
    const existing = byDate.get(entry.date) || [];
    existing.push(entry);
    byDate.set(entry.date, existing);
  }

  const lines: string[] = [];
  let grandTotal = 0;

  for (const [date, dayEntries] of byDate) {
    const dayTotal = dayEntries.reduce((sum, e) => sum + e.totalSeconds, 0);
    grandTotal += dayTotal;
    lines.push(`## ${date} (${formatDurationHuman(dayTotal)})`);
    lines.push('');
    for (const entry of dayEntries) {
      lines.push(`- ${entry.taskTitle}: ${formatDurationHuman(entry.totalSeconds)}`);
    }
    lines.push('');
  }

  lines.push(`**Total: ${formatDurationHuman(grandTotal)}**`);
  return lines.join('\n');
}

type CommentRow = Pick<Comment, 'id' | 'body' | 'syncable' | 'createdAt'>;

export function formatCommentList(comments: CommentRow[]): string {
  if (comments.length === 0) return 'No comments.';

  return comments.map((c) => {
    const date = formatDate(c.createdAt);
    const sync = c.syncable ? ' [syncable]' : '';
    return `[${c.id.slice(0, 8)}] ${date}${sync}\n  ${c.body}`;
  }).join('\n\n');
}

type CategoryRow = Pick<Category, 'id' | 'name' | 'color'>;

export function formatCategoryList(categories: CategoryRow[]): string {
  if (categories.length === 0) return 'No categories.';

  return categories.map((c) =>
    `${padRight(c.id.slice(0, 8), 10)}${padRight(c.name, 20)}${c.color}`
  ).join('\n');
}
