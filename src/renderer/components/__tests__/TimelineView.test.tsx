import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TimelineView } from '../TimelineView';
import type { TimeEntryWithTask } from '../../../shared/types';

function localTime(hours: number, minutes: number = 0): string {
  return new Date(2026, 2, 6, hours, minutes, 0, 0).toISOString();
}

describe('TimelineView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 2, 6, 12, 0, 0, 0));

    localStorage.removeItem('ct-option-work-hours-start');
    localStorage.removeItem('ct-option-work-hours-end');
    localStorage.removeItem('ct-option-min-gap-minutes');
    localStorage.removeItem('ct-option-gap-label');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders title and totals', async () => {
    const entries: TimeEntryWithTask[] = [
      {
        id: 'e1',
        taskId: 't1',
        startTime: localTime(9, 0),
        endTime: localTime(10, 0),
        durationSeconds: 3600,
        note: '',
        createdAt: localTime(9, 0),
        taskTitle: 'Test Task',
        taskSource: 'ad-hoc',
      },
    ];

    (window.api.timeEntries.getByDateRangeWithTasks as ReturnType<typeof vi.fn>)
      .mockResolvedValue(entries);

    render(<TimelineView />);

    await waitFor(() => {
      expect(screen.getByText("Today's Timeline")).toBeInTheDocument();
    });

    expect(screen.getByText(/Tracked: 1h/)).toBeInTheDocument();
  });

  it('shows empty message when no entries', async () => {
    (window.api.timeEntries.getByDateRangeWithTasks as ReturnType<typeof vi.fn>)
      .mockResolvedValue([]);

    render(<TimelineView />);

    await waitFor(() => {
      expect(screen.getByText('No time entries for today.')).toBeInTheDocument();
    });
  });

  it('displays entry with source prefix', async () => {
    const entries: TimeEntryWithTask[] = [
      {
        id: 'e1',
        taskId: 't1',
        startTime: localTime(9, 0),
        endTime: localTime(10, 0),
        durationSeconds: 3600,
        note: '',
        createdAt: localTime(9, 0),
        taskTitle: 'Reply to client',
        taskSource: 'email',
      },
    ];

    (window.api.timeEntries.getByDateRangeWithTasks as ReturnType<typeof vi.fn>)
      .mockResolvedValue(entries);

    render(<TimelineView />);

    await waitFor(() => {
      expect(screen.getByText(/\[Email\] Reply to client/)).toBeInTheDocument();
    });
  });

  it('displays gap markers', async () => {
    const entries: TimeEntryWithTask[] = [
      {
        id: 'e1',
        taskId: 't1',
        startTime: localTime(9, 0),
        endTime: localTime(10, 0),
        durationSeconds: 3600,
        note: '',
        createdAt: localTime(9, 0),
        taskTitle: 'Task A',
        taskSource: 'ad-hoc',
      },
      {
        id: 'e2',
        taskId: 't2',
        startTime: localTime(10, 30),
        endTime: localTime(11, 30),
        durationSeconds: 3600,
        note: '',
        createdAt: localTime(10, 30),
        taskTitle: 'Task B',
        taskSource: 'ad-hoc',
      },
    ];

    (window.api.timeEntries.getByDateRangeWithTasks as ReturnType<typeof vi.fn>)
      .mockResolvedValue(entries);

    render(<TimelineView />);

    await waitFor(() => {
      const gaps = screen.getAllByText(/\[gap\].*untracked/);
      expect(gaps.length).toBeGreaterThanOrEqual(1);
      // At least one should be the 30m gap between entries
      expect(gaps.some((el) => el.textContent?.includes('30m'))).toBe(true);
    });
  });
});
