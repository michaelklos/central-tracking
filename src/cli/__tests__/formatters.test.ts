import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatDate,
  formatTime,
  truncate,
  padRight,
  padLeft,
  formatTaskTable,
  formatTimeEntryTable,
  formatSummaryReport,
  formatCommentList,
  formatCategoryList,
} from '../formatters';

describe('formatDuration', () => {
  it('formats minutes only', () => {
    expect(formatDuration(300)).toBe('5m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('formats hours with no remaining minutes', () => {
    expect(formatDuration(7200)).toBe('2h 0m');
  });
});

describe('formatDate', () => {
  it('extracts date from ISO string', () => {
    expect(formatDate('2026-04-11T10:30:00.000Z')).toBe('2026-04-11');
  });
});

describe('formatTime', () => {
  it('formats time from ISO string', () => {
    const result = formatTime('2026-04-11T10:30:00.000Z');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('truncate', () => {
  it('does not truncate short strings', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis', () => {
    expect(truncate('hello world', 6)).toBe('hello\u2026');
  });
});

describe('padRight / padLeft', () => {
  it('pads right', () => {
    expect(padRight('hi', 5)).toBe('hi   ');
  });

  it('pads left', () => {
    expect(padLeft('hi', 5)).toBe('   hi');
  });

  it('does not pad when string is already long enough', () => {
    expect(padRight('hello', 3)).toBe('hello');
    expect(padLeft('hello', 3)).toBe('hello');
  });
});

describe('formatTaskTable', () => {
  it('returns no-tasks message for empty array', () => {
    expect(formatTaskTable([])).toBe('No tasks found.');
  });

  it('formats task rows with header', () => {
    const tasks = [
      {
        id: '12345678-1234-1234-1234-123456789abc',
        title: 'Test Task',
        status: 'todo',
        source: 'ad-hoc',
        totalTimeSeconds: 3600,
        todayTimeSeconds: 300,
        categoryIds: [],
        createdAt: '2026-04-11T00:00:00Z',
      },
    ];
    const result = formatTaskTable(tasks);
    expect(result).toContain('ID');
    expect(result).toContain('Title');
    expect(result).toContain('12345678');
    expect(result).toContain('Test Task');
    expect(result).toContain('todo');
  });
});

describe('formatTimeEntryTable', () => {
  it('returns no-entries message for empty array', () => {
    expect(formatTimeEntryTable([])).toBe('No time entries found.');
  });

  it('formats entries with running indicator', () => {
    const entries = [
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        taskId: 'task-1',
        startTime: '2026-04-11T09:00:00Z',
        endTime: null,
        durationSeconds: null,
        note: 'working',
      },
    ];
    const result = formatTimeEntryTable(entries);
    expect(result).toContain('running');
    expect(result).toContain('working');
  });
});

describe('formatSummaryReport', () => {
  it('returns no-entries message for empty array', () => {
    expect(formatSummaryReport([])).toBe('No time entries in this date range.');
  });

  it('groups by date with totals', () => {
    const entries = [
      { date: '2026-04-11', taskTitle: 'Task A', totalSeconds: 3600, taskSource: 'ad-hoc', taskStatus: 'todo' },
      { date: '2026-04-11', taskTitle: 'Task B', totalSeconds: 1800, taskSource: 'ad-hoc', taskStatus: 'todo' },
      { date: '2026-04-12', taskTitle: 'Task A', totalSeconds: 7200, taskSource: 'ad-hoc', taskStatus: 'todo' },
    ];
    const result = formatSummaryReport(entries);
    expect(result).toContain('## 2026-04-11');
    expect(result).toContain('## 2026-04-12');
    expect(result).toContain('Task A: 1h 0m');
    expect(result).toContain('Task B: 30m');
    expect(result).toContain('**Total:');
  });
});

describe('formatCommentList', () => {
  it('returns no-comments message for empty array', () => {
    expect(formatCommentList([])).toBe('No comments.');
  });

  it('formats comments with dates and syncable flag', () => {
    const comments = [
      { id: 'aaaaaaaa-1111-2222-3333-444444444444', body: 'Test comment', syncable: true, createdAt: '2026-04-11T10:00:00Z' },
    ];
    const result = formatCommentList(comments);
    expect(result).toContain('[syncable]');
    expect(result).toContain('Test comment');
    expect(result).toContain('2026-04-11');
  });
});

describe('formatCategoryList', () => {
  it('returns no-categories message for empty array', () => {
    expect(formatCategoryList([])).toBe('No categories.');
  });

  it('formats categories with color', () => {
    const categories = [
      { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'Work', color: '#ff0000' },
    ];
    const result = formatCategoryList(categories);
    expect(result).toContain('Work');
    expect(result).toContain('#ff0000');
  });
});
