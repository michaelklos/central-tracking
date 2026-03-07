import type { TimeEntryWithTask } from '../../shared/types';

export interface TimelineOptions {
  workStartTime: string;   // "08:00"
  workEndTime: string;     // "17:00"
  minGapMinutes: number;   // 15
  gapLabel: string;        // "gap"
}

export interface TimelineItem {
  type: 'entry' | 'gap';
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  // entry fields
  taskId?: string;
  taskTitle?: string;
  taskSource?: string;
  entryId?: string;
  // gap fields
  label?: string;
}

function timeStringToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function setTimeOnDate(date: Date, timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

export function buildTimeline(entries: TimeEntryWithTask[], options: TimelineOptions): TimelineItem[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const items: TimelineItem[] = [];
  const now = new Date();

  // Reference date from first entry for work hours
  const refDate = new Date(sorted[0].startTime);
  const workStart = setTimeOnDate(refDate, options.workStartTime);
  const workEnd = setTimeOnDate(refDate, options.workEndTime);
  const workStartMinutes = timeStringToMinutes(options.workStartTime);
  const workEndMinutes = timeStringToMinutes(options.workEndTime);

  function isWithinWorkHours(time: Date): boolean {
    const mins = time.getHours() * 60 + time.getMinutes();
    return mins >= workStartMinutes && mins <= workEndMinutes;
  }

  function clampToWorkHours(start: Date, end: Date): { start: Date; end: Date } | null {
    const clampedStart = start < workStart ? workStart : start;
    const clampedEnd = end > workEnd ? workEnd : end;
    if (clampedStart >= clampedEnd) return null;
    return { start: clampedStart, end: clampedEnd };
  }

  function addGapIfNeeded(gapStart: Date, gapEnd: Date) {
    const clamped = clampToWorkHours(gapStart, gapEnd);
    if (!clamped) return;
    const durationSeconds = Math.floor((clamped.end.getTime() - clamped.start.getTime()) / 1000);
    const durationMinutes = durationSeconds / 60;
    if (durationMinutes >= options.minGapMinutes) {
      items.push({
        type: 'gap',
        startTime: clamped.start,
        endTime: clamped.end,
        durationSeconds,
        label: options.gapLabel,
      });
    }
  }

  // Gap before first entry (from work start)
  const firstStart = new Date(sorted[0].startTime);
  addGapIfNeeded(workStart, firstStart);

  // Walk entries
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const entryStart = new Date(entry.startTime);
    const entryEnd = entry.endTime ? new Date(entry.endTime) : now;

    items.push({
      type: 'entry',
      startTime: entryStart,
      endTime: entryEnd,
      durationSeconds: Math.floor((entryEnd.getTime() - entryStart.getTime()) / 1000),
      taskId: entry.taskId,
      taskTitle: entry.taskTitle,
      taskSource: entry.taskSource,
      entryId: entry.id,
    });

    // Gap between this entry and next
    if (i < sorted.length - 1) {
      const nextStart = new Date(sorted[i + 1].startTime);
      addGapIfNeeded(entryEnd, nextStart);
    }
  }

  // Gap after last entry (to work end or now, whichever is earlier)
  const lastEntry = sorted[sorted.length - 1];
  const lastEnd = lastEntry.endTime ? new Date(lastEntry.endTime) : now;
  const gapBoundary = now < workEnd ? now : workEnd;
  if (lastEntry.endTime) {
    // Only add trailing gap for completed entries
    addGapIfNeeded(lastEnd, gapBoundary);
  }

  return items;
}
