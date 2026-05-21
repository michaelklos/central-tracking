import { describe, it, expect } from 'vitest';
import { validateTimeEntry } from '../timeValidation';
import type { TimeEntry } from '../../../shared/types';

const makeEntry = (overrides: Partial<TimeEntry> = {}): TimeEntry => ({
  id: 'e1',
  taskId: 'task-1',
  startTime: '2024-01-01T09:00:00Z',
  endTime: '2024-01-01T10:00:00Z',
  durationSeconds: 3600,
  note: '',
  reportedAt: null,
  createdAt: '2024-01-01T09:00:00Z',
  ...overrides,
});

describe('validateTimeEntry', () => {
  it('returns invalid when end < start', () => {
    const result = validateTimeEntry(
      '2024-01-01T10:00:00Z',
      '2024-01-01T09:00:00Z',
      []
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('after start');
  });

  it('returns invalid when duration is zero (end == start)', () => {
    const result = validateTimeEntry(
      '2024-01-01T09:00:00Z',
      '2024-01-01T09:00:00Z',
      []
    );
    expect(result.valid).toBe(false);
  });

  it('returns invalid when overlaps with existing entry', () => {
    const existing = [makeEntry({ startTime: '2024-01-01T09:00:00Z', endTime: '2024-01-01T10:00:00Z' })];
    const result = validateTimeEntry(
      '2024-01-01T09:30:00Z',
      '2024-01-01T10:30:00Z',
      existing
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Overlaps');
  });

  it('returns valid when excludeId matches the overlapping entry (editing self)', () => {
    const existing = [makeEntry({ id: 'e1', startTime: '2024-01-01T09:00:00Z', endTime: '2024-01-01T10:00:00Z' })];
    const result = validateTimeEntry(
      '2024-01-01T09:00:00Z',
      '2024-01-01T10:30:00Z',
      existing,
      'e1'
    );
    expect(result.valid).toBe(true);
  });

  it('returns valid for non-overlapping entry', () => {
    const existing = [makeEntry({ startTime: '2024-01-01T09:00:00Z', endTime: '2024-01-01T10:00:00Z' })];
    const result = validateTimeEntry(
      '2024-01-01T10:00:00Z',
      '2024-01-01T11:00:00Z',
      existing
    );
    expect(result.valid).toBe(true);
  });
});
