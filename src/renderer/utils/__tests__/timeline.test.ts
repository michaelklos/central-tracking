import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildTimeline, type TimelineOptions } from '../timeline';
import type { TimeEntryWithTask } from '../../../shared/types';

const defaultOptions: TimelineOptions = {
  workStartTime: '08:00',
  workEndTime: '17:00',
  minGapMinutes: 15,
  gapLabel: 'gap',
};

/** Create a local-time ISO string for March 6 2026 at the given hour/minute. */
function localTime(hours: number, minutes: number = 0): string {
  return new Date(2026, 2, 6, hours, minutes, 0, 0).toISOString();
}

function makeEntry(overrides: Partial<TimeEntryWithTask> = {}): TimeEntryWithTask {
  return {
    id: 'entry-1',
    taskId: 'task-1',
    startTime: localTime(9, 0),
    endTime: localTime(10, 0),
    durationSeconds: 3600,
    note: '',
    reportedAt: null,
    createdAt: localTime(9, 0),
    taskTitle: 'Test Task',
    taskSource: 'ad-hoc',
    ...overrides,
  };
}

describe('buildTimeline', () => {
  beforeEach(() => {
    // Freeze time at 10:30 local on March 6 2026 — within work hours, after test entries
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 6, 10, 30, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array for no entries', () => {
    expect(buildTimeline([], defaultOptions)).toEqual([]);
  });

  it('includes entry items', () => {
    const entries = [makeEntry()];
    const result = buildTimeline(entries, defaultOptions);

    const entryItems = result.filter((i) => i.type === 'entry');
    expect(entryItems).toHaveLength(1);
    expect(entryItems[0].taskTitle).toBe('Test Task');
    expect(entryItems[0].durationSeconds).toBe(3600);
  });

  it('detects gap between entries', () => {
    const entries = [
      makeEntry({
        id: 'e1',
        startTime: localTime(8, 0),
        endTime: localTime(9, 0),
      }),
      makeEntry({
        id: 'e2',
        startTime: localTime(9, 30),
        endTime: localTime(10, 30),
      }),
    ];

    const result = buildTimeline(entries, defaultOptions);
    const gaps = result.filter((i) => i.type === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationSeconds).toBe(1800); // 30 minutes
    expect(gaps[0].label).toBe('gap');
  });

  it('ignores gaps shorter than minGapMinutes', () => {
    const entries = [
      makeEntry({
        id: 'e1',
        startTime: localTime(8, 0),
        endTime: localTime(9, 0),
      }),
      makeEntry({
        id: 'e2',
        startTime: localTime(9, 10),
        endTime: localTime(10, 0),
      }),
    ];

    // Freeze at exactly 10:00 so no trailing gap
    vi.setSystemTime(new Date(2026, 2, 6, 10, 0, 0, 0));

    const result = buildTimeline(entries, defaultOptions);
    const gaps = result.filter((i) => i.type === 'gap');
    expect(gaps).toHaveLength(0);
  });

  it('detects gap before first entry from work start', () => {
    const entries = [
      makeEntry({
        startTime: localTime(9, 0),
        endTime: localTime(10, 0),
      }),
    ];

    const result = buildTimeline(entries, defaultOptions);
    // First item should be a gap from 08:00 to 09:00
    expect(result[0].type).toBe('gap');
    expect(result[0].durationSeconds).toBe(3600);
  });

  it('only flags gaps within work hours', () => {
    const entries = [
      makeEntry({
        startTime: localTime(6, 0),
        endTime: localTime(7, 0),
      }),
      makeEntry({
        id: 'e2',
        startTime: localTime(9, 0),
        endTime: localTime(10, 30),
      }),
    ];

    const result = buildTimeline(entries, defaultOptions);
    const gaps = result.filter((i) => i.type === 'gap');
    // Gap from 07:00-09:00, clamped to 08:00-09:00 = 1h gap
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationSeconds).toBe(3600);
    expect(gaps[0].startTime.getHours()).toBe(8);
  });

  it('handles active (running) entry using current time', () => {
    vi.setSystemTime(new Date(2026, 2, 6, 11, 0, 0, 0));

    const entries = [
      makeEntry({
        startTime: localTime(10, 0),
        endTime: null,
        durationSeconds: null,
      }),
    ];

    const result = buildTimeline(entries, defaultOptions);
    const entryItems = result.filter((i) => i.type === 'entry');
    expect(entryItems).toHaveLength(1);
    expect(entryItems[0].durationSeconds).toBe(3600); // 1 hour until "now"
  });

  it('sorts entries by start time', () => {
    const entries = [
      makeEntry({
        id: 'e2',
        startTime: localTime(9, 30),
        endTime: localTime(10, 30),
      }),
      makeEntry({
        id: 'e1',
        startTime: localTime(8, 0),
        endTime: localTime(9, 0),
      }),
    ];

    const result = buildTimeline(entries, defaultOptions);
    const entryItems = result.filter((i) => i.type === 'entry');
    expect(entryItems[0].entryId).toBe('e1');
    expect(entryItems[1].entryId).toBe('e2');
  });

  it('uses custom gap label', () => {
    const entries = [
      makeEntry({
        id: 'e1',
        startTime: localTime(8, 0),
        endTime: localTime(9, 0),
      }),
      makeEntry({
        id: 'e2',
        startTime: localTime(9, 30),
        endTime: localTime(10, 30),
      }),
    ];

    const result = buildTimeline(entries, { ...defaultOptions, gapLabel: 'break' });
    const gaps = result.filter((i) => i.type === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].label).toBe('break');
  });
});
