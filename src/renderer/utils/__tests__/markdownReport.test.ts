import { describe, it, expect } from 'vitest';
import { generateMarkdownReport } from '../markdownReport';
import type { SummaryReportEntry } from '../../../shared/types';

describe('generateMarkdownReport', () => {
  const makeEntry = (overrides: Partial<SummaryReportEntry> = {}): SummaryReportEntry => ({
    date: '2026-02-26',
    taskId: 'task-1',
    taskTitle: 'Task Name 1',
    taskSource: 'ad-hoc',
    taskStatus: 'in-progress',
    categoryIds: [],
    totalSeconds: 3600,
    ...overrides,
  });

  it('generates report with header and totals', () => {
    const entries = [makeEntry({ totalSeconds: 16320 })];
    const result = generateMarkdownReport(entries, {
      startDate: '2026-02-26',
      endDate: '2026-03-02',
    });

    expect(result).toContain('# 2026-02-26 to 2026-03-02');
    expect(result).toContain('4h 32m Tracked');
  });

  it('includes category names when provided', () => {
    const result = generateMarkdownReport([makeEntry()], {
      startDate: '2026-02-26',
      endDate: '2026-03-02',
      categoryNames: ['Invoice', 'Meetings'],
    });

    expect(result).toContain('Categories: Invoice, Meetings');
  });

  it('omits categories line when none provided', () => {
    const result = generateMarkdownReport([makeEntry()], {
      startDate: '2026-02-26',
      endDate: '2026-03-02',
    });

    expect(result).not.toContain('Categories:');
  });

  it('prefixes source for email tasks', () => {
    const result = generateMarkdownReport(
      [makeEntry({ taskSource: 'email', taskTitle: 'Reply to client' })],
      { startDate: '2026-02-26', endDate: '2026-02-26' }
    );

    expect(result).toContain('* [Email] Reply to client');
  });

  it('prefixes source for meeting-prep tasks', () => {
    const result = generateMarkdownReport(
      [makeEntry({ taskSource: 'meeting-prep', taskTitle: 'Sprint review' })],
      { startDate: '2026-02-26', endDate: '2026-02-26' }
    );

    expect(result).toContain('* [Meeting Prep] Sprint review');
  });

  it('prefixes source for plugin tasks', () => {
    const result = generateMarkdownReport(
      [makeEntry({ taskSource: 'plugin', taskTitle: 'ADO Item' })],
      { startDate: '2026-02-26', endDate: '2026-02-26' }
    );

    expect(result).toContain('* [Plugin] ADO Item');
  });

  it('omits prefix for ad-hoc tasks', () => {
    const result = generateMarkdownReport(
      [makeEntry({ taskSource: 'ad-hoc', taskTitle: 'Some Task' })],
      { startDate: '2026-02-26', endDate: '2026-02-26' }
    );

    expect(result).toContain('* Some Task (1h)');
    expect(result).not.toContain('[');
  });

  it('groups entries by date with day totals', () => {
    const entries = [
      makeEntry({ date: '2026-02-26', totalSeconds: 3600, taskTitle: 'Task A' }),
      makeEntry({ date: '2026-02-26', totalSeconds: 7200, taskTitle: 'Task B' }),
      makeEntry({ date: '2026-02-27', totalSeconds: 1800, taskTitle: 'Task C' }),
    ];

    const result = generateMarkdownReport(entries, {
      startDate: '2026-02-26',
      endDate: '2026-02-27',
    });

    expect(result).toContain('## 2026-02-26');
    expect(result).toContain('3h Tracked'); // day total for Feb 26
    expect(result).toContain('## 2026-02-27');
    expect(result).toContain('30m Tracked'); // day total for Feb 27
  });

  it('handles empty entries', () => {
    const result = generateMarkdownReport([], {
      startDate: '2026-02-26',
      endDate: '2026-03-02',
    });

    expect(result).toContain('# 2026-02-26 to 2026-03-02');
    expect(result).toContain('0m Tracked');
  });
});
