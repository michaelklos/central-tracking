export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

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

interface TaskLike {
  id: string;
  title: string;
  status: string;
  source: string;
  totalTimeSeconds: number;
  todayTimeSeconds: number;
  categoryIds: string[];
  createdAt: string;
}

export function formatTaskTable(tasks: TaskLike[], options?: { fullId?: boolean }): string {
  if (tasks.length === 0) return 'No tasks found.';

  const full = options?.fullId ?? false;
  const idWidth = full ? 38 : 10;
  const titleWidth = full ? 30 : 52;

  const rows = tasks.map((t) => ({
    id: full ? t.id : t.id.slice(0, 8),
    title: truncate(t.title, titleWidth - 2),
    status: t.status,
    source: t.source,
    today: formatDuration(t.todayTimeSeconds),
    total: formatDuration(t.totalTimeSeconds),
  }));

  const header = `${padRight('ID', idWidth)}${padRight('Title', titleWidth)}${padRight('Status', 14)}${padRight('Source', 12)}${padLeft('Today', 8)}${padLeft('Total', 8)}`;
  const separator = '-'.repeat(header.length);
  const lines = rows.map(
    (r) =>
      `${padRight(r.id, idWidth)}${padRight(r.title, titleWidth)}${padRight(r.status, 14)}${padRight(r.source, 12)}${padLeft(r.today, 8)}${padLeft(r.total, 8)}`
  );

  return [header, separator, ...lines].join('\n');
}

interface TimeEntryLike {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  note: string;
}

export function formatTimeEntryTable(entries: TimeEntryLike[]): string {
  if (entries.length === 0) return 'No time entries found.';

  const rows = entries.map((e) => ({
    id: e.id.slice(0, 8),
    date: formatDate(e.startTime),
    start: formatTime(e.startTime),
    end: e.endTime ? formatTime(e.endTime) : 'running',
    duration: e.durationSeconds ? formatDuration(e.durationSeconds) : '-',
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

interface SummaryEntry {
  date: string;
  taskTitle: string;
  totalSeconds: number;
  taskSource: string;
  taskStatus: string;
}

export function formatSummaryReport(entries: SummaryEntry[]): string {
  if (entries.length === 0) return 'No time entries in this date range.';

  // Group by date
  const byDate = new Map<string, SummaryEntry[]>();
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
    lines.push(`## ${date} (${formatDuration(dayTotal)})`);
    lines.push('');
    for (const entry of dayEntries) {
      lines.push(`- ${entry.taskTitle}: ${formatDuration(entry.totalSeconds)}`);
    }
    lines.push('');
  }

  lines.push(`**Total: ${formatDuration(grandTotal)}**`);
  return lines.join('\n');
}

interface CommentLike {
  id: string;
  body: string;
  syncable: boolean;
  createdAt: string;
}

export function formatCommentList(comments: CommentLike[]): string {
  if (comments.length === 0) return 'No comments.';

  return comments.map((c) => {
    const date = formatDate(c.createdAt);
    const sync = c.syncable ? ' [syncable]' : '';
    return `[${c.id.slice(0, 8)}] ${date}${sync}\n  ${c.body}`;
  }).join('\n\n');
}

interface CategoryLike {
  id: string;
  name: string;
  color: string;
}

export function formatCategoryList(categories: CategoryLike[]): string {
  if (categories.length === 0) return 'No categories.';

  return categories.map((c) =>
    `${padRight(c.id.slice(0, 8), 10)}${padRight(c.name, 20)}${c.color}`
  ).join('\n');
}
