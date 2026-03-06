import type { SummaryReportEntry, TaskSource } from '../../shared/types';
import { formatDurationHuman } from '../../shared/duration';

function sourcePrefix(source: TaskSource): string {
  switch (source) {
    case 'email': return '[Email] ';
    case 'meeting-prep': return '[Meeting Prep] ';
    case 'plugin': return '[Plugin] ';
    default: return '';
  }
}

export function generateMarkdownReport(
  entries: SummaryReportEntry[],
  meta: { startDate: string; endDate: string; categoryNames?: string[] }
): string {
  const lines: string[] = [];

  lines.push(`# ${meta.startDate} to ${meta.endDate}`);
  if (meta.categoryNames && meta.categoryNames.length > 0) {
    lines.push(`Categories: ${meta.categoryNames.join(', ')}`);
  }

  const grandTotal = entries.reduce((sum, e) => sum + e.totalSeconds, 0);
  lines.push(`${formatDurationHuman(grandTotal)} Tracked`);
  lines.push('');

  // Group entries by date
  const byDate = new Map<string, SummaryReportEntry[]>();
  for (const entry of entries) {
    const group = byDate.get(entry.date) ?? [];
    group.push(entry);
    byDate.set(entry.date, group);
  }

  for (const [date, dayEntries] of byDate) {
    const dayTotal = dayEntries.reduce((sum, e) => sum + e.totalSeconds, 0);
    lines.push(`## ${date}`);
    lines.push(`${formatDurationHuman(dayTotal)} Tracked`);
    for (const entry of dayEntries) {
      const prefix = sourcePrefix(entry.taskSource);
      lines.push(`* ${prefix}${entry.taskTitle} (${formatDurationHuman(entry.totalSeconds)})`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
