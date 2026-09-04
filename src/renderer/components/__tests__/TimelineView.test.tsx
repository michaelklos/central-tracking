import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TimelineView } from '../TimelineView';
import type { TimeEntryWithTask } from '../../../shared/types';

const mockSetSearchParams = vi.fn();
// Mutable so a test can navigate between days and re-render.
let mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => ({
    selectTask: vi.fn(),
    createTask: vi.fn().mockResolvedValue({ id: 'new-task' }),
    setPendingTimeEntry: vi.fn(),
  }),
}));

function localTime(hours: number, minutes: number = 0): string {
  return new Date(2026, 2, 6, hours, minutes, 0, 0).toISOString();
}

describe('TimelineView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
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
        reportedAt: null,
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

  it('ignores a slow load for a day the user already navigated away from', async () => {
    // CLAUDE.md recurring footgun 3: `await ipc(); setState(result)` with no
    // staleness guard. Switching days mid-fetch let the old day's entries
    // overwrite the new day's timeline.
    const makeEntry = (title: string, day: number): TimeEntryWithTask => ({
      id: `e-${title}`,
      taskId: `t-${title}`,
      startTime: new Date(2026, 2, day, 9, 0, 0, 0).toISOString(),
      endTime: new Date(2026, 2, day, 10, 0, 0, 0).toISOString(),
      durationSeconds: 3600,
      note: '',
      reportedAt: null,
      createdAt: new Date(2026, 2, day, 9, 0, 0, 0).toISOString(),
      taskTitle: title,
      taskSource: 'ad-hoc',
    });

    let resolveFirst: (v: TimeEntryWithTask[]) => void = () => {};
    const firstLoad = new Promise<TimeEntryWithTask[]>((r) => {
      resolveFirst = r;
    });

    const api = window.api.timeEntries.getByDateRangeWithTasks as ReturnType<typeof vi.fn>;
    api.mockReturnValueOnce(firstLoad).mockResolvedValue([makeEntry('Newer day', 6)]);

    mockSearchParams = new URLSearchParams({ date: '2026-03-05' });
    const { rerender } = render(<TimelineView />);

    // Navigate to another day; its (fast) load resolves first.
    mockSearchParams = new URLSearchParams({ date: '2026-03-06' });
    rerender(<TimelineView />);
    await waitFor(() => {
      expect(screen.getByText(/Newer day/)).toBeInTheDocument();
    });

    // The abandoned day's fetch now lands.
    resolveFirst([makeEntry('Older day', 5)]);
    await Promise.resolve();

    await waitFor(() => {
      expect(screen.getByText(/Newer day/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Older day/)).not.toBeInTheDocument();
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
        reportedAt: null,
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
        reportedAt: null,
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
        reportedAt: null,
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
