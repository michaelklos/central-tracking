import { parseDuration } from '../../shared/duration';
import type { ParsedImportItem, ImportError, TaskSource } from '../../shared/types';

interface ParseResult {
  items: ParsedImportItem[];
  errors: ImportError[];
}

const DATE_HEADER_RE = /^#\s+(\d{4}-\d{2}-\d{2})\s*$/;
const TASK_LINE_RE = /^\*\s+(?:\[([^\]]+)\]\s+)?(.+?):\s+(\d{1,2}:\d{2})\s+\((.+?)\)\s*$/;

function detectSource(ticket: string | null): { source: TaskSource; pluginId: string | null } {
  if (!ticket) return { source: 'ad-hoc', pluginId: null };
  if (/^\d+$/.test(ticket)) return { source: 'plugin', pluginId: 'ado' };
  if (/^[A-Z]+-\d+$/i.test(ticket)) return { source: 'plugin', pluginId: 'jira' };
  return { source: 'ad-hoc', pluginId: null };
}

export function parseMarkdownImport(content: string): ParseResult {
  const lines = content.split('\n');
  const items: ParsedImportItem[] = [];
  const errors: ImportError[] = [];
  let currentDate: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('<!--')) continue;

    const dateMatch = trimmed.match(DATE_HEADER_RE);
    if (dateMatch) {
      currentDate = dateMatch[1];
      continue;
    }

    if (!trimmed.startsWith('*')) continue;

    if (!currentDate) {
      errors.push({ lineNumber, line: trimmed, reason: 'Task line appears before any date header' });
      continue;
    }

    const taskMatch = trimmed.match(TASK_LINE_RE);
    if (!taskMatch) {
      errors.push({ lineNumber, line: trimmed, reason: 'Malformed task line' });
      continue;
    }

    const [, ticket, name, startTimeStr, durationStr] = taskMatch;
    const durationSeconds = parseDuration(durationStr);

    if (durationSeconds === null || durationSeconds <= 0) {
      errors.push({ lineNumber, line: trimmed, reason: `Invalid duration: "${durationStr}"` });
      continue;
    }

    const title = ticket ? `[${ticket}] ${name.trim()}` : name.trim();
    const externalId = ticket || null;
    const { source, pluginId } = detectSource(ticket);

    const [year, month, day] = currentDate.split('-').map(Number);
    const [hours, minutes] = startTimeStr.padStart(5, '0').split(':').map(Number);
    const startDateObj = new Date(year, month - 1, day, hours, minutes, 0, 0);
    const startDateTime = startDateObj.toISOString();
    const endDate = new Date(startDateObj.getTime() + durationSeconds * 1000);
    const endDateTime = endDate.toISOString();

    items.push({
      lineNumber,
      title,
      externalId,
      source,
      pluginId,
      date: currentDate,
      startTime: startTimeStr,
      durationSeconds,
      startDateTime,
      endDateTime,
    });
  }

  return { items, errors };
}
