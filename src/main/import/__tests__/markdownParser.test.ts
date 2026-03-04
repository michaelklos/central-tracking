import { describe, it, expect } from 'vitest';
import { parseMarkdownImport } from '../markdownParser';

describe('parseMarkdownImport', () => {
  it('parses a basic task with ticket number', () => {
    const input = `# 2026-03-04
* [TK-101] Fix login bug: 09:30 (1h 45m)`;

    const { items, errors } = parseMarkdownImport(input);
    expect(errors).toHaveLength(0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      lineNumber: 2,
      title: '[TK-101] Fix login bug',
      externalId: 'TK-101',
      source: 'plugin',
      pluginId: 'jira',
      date: '2026-03-04',
      startTime: '09:30',
      durationSeconds: 6300, // 1h 45m
    });
  });

  it('parses a task without ticket number', () => {
    const input = `# 2026-03-04
* Meeting prep: 14:00 (45m)`;

    const { items, errors } = parseMarkdownImport(input);
    expect(errors).toHaveLength(0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Meeting prep',
      externalId: null,
      source: 'ad-hoc',
      pluginId: null,
      durationSeconds: 2700, // 45m
    });
  });

  it('detects ADO source for numeric tickets', () => {
    const input = `# 2026-03-04
* [12345] Fix API endpoint: 10:00 (30m)`;

    const { items } = parseMarkdownImport(input);
    expect(items[0]).toMatchObject({
      title: '[12345] Fix API endpoint',
      externalId: '12345',
      source: 'plugin',
      pluginId: 'ado',
    });
  });

  it('detects Jira source for alpha-dash tickets', () => {
    const input = `# 2026-03-04
* [PROJ-123] Implement feature: 10:00 (1h)`;

    const { items } = parseMarkdownImport(input);
    expect(items[0]).toMatchObject({
      externalId: 'PROJ-123',
      source: 'plugin',
      pluginId: 'jira',
    });
  });

  it('parses multiple tasks under one date', () => {
    const input = `# 2026-03-04
* [TK-101] Fix login bug: 09:30 (1h 45m)
* [TK-102] Review PR: 11:15 (30m)
* Meeting prep: 14:00 (45m)`;

    const { items, errors } = parseMarkdownImport(input);
    expect(errors).toHaveLength(0);
    expect(items).toHaveLength(3);
  });

  it('handles multiple date headers', () => {
    const input = `# 2026-03-04
* Task one: 09:00 (1h)

# 2026-03-05
* Task two: 10:00 (2h)`;

    const { items } = parseMarkdownImport(input);
    expect(items).toHaveLength(2);
    expect(items[0].date).toBe('2026-03-04');
    expect(items[1].date).toBe('2026-03-05');
  });

  it('computes correct start and end datetimes', () => {
    const input = `# 2026-03-04
* Work item: 09:30 (1h 30m)`;

    const { items } = parseMarkdownImport(input);
    expect(items[0].startDateTime).toBe('2026-03-04T09:30:00.000Z');
    // 1h 30m = 5400s after 09:30 = 11:00
    const endDate = new Date(items[0].endDateTime);
    expect(endDate.getUTCHours()).toBe(11);
    expect(endDate.getUTCMinutes()).toBe(0);
  });

  it('returns error for task before any date header', () => {
    const input = `* Orphan task: 09:00 (1h)`;

    const { items, errors } = parseMarkdownImport(input);
    expect(items).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain('before any date header');
  });

  it('returns error for malformed task line', () => {
    const input = `# 2026-03-04
* This is not a valid task line`;

    const { items, errors } = parseMarkdownImport(input);
    expect(items).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain('Malformed task line');
  });

  it('returns error for invalid duration', () => {
    const input = `# 2026-03-04
* Bad duration task: 09:00 (abc)`;

    const { items, errors } = parseMarkdownImport(input);
    expect(items).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain('Invalid duration');
  });

  it('skips blank lines and comments', () => {
    const input = `# 2026-03-04

// this is a comment
<!-- html comment -->

* Real task: 09:00 (1h)`;

    const { items, errors } = parseMarkdownImport(input);
    expect(errors).toHaveLength(0);
    expect(items).toHaveLength(1);
  });

  it('returns empty results for empty input', () => {
    const { items, errors } = parseMarkdownImport('');
    expect(items).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('handles various duration formats', () => {
    const input = `# 2026-03-04
* Task A: 09:00 (2h)
* Task B: 11:00 (30m)
* Task C: 12:00 (1h 30m)`;

    const { items } = parseMarkdownImport(input);
    expect(items[0].durationSeconds).toBe(7200);  // 2h
    expect(items[1].durationSeconds).toBe(1800);  // 30m
    expect(items[2].durationSeconds).toBe(5400);  // 1h 30m
  });
});
