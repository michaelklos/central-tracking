import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDetail } from '../TaskDetail';
import type { Task, Comment } from '../../../shared/types';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  description: '',
  status: 'todo',
  source: 'ad-hoc',
  externalId: null,
  pluginId: null,
  sortOrder: 0,
  totalTimeSeconds: 0,
  todayTimeSeconds: 0,
  unreportedTimeSeconds: 0,
  hasUnreportedTime: false,
  categoryIds: [],
  notes: '',
  deletedAt: null,
  externalUrl: null,
  externalState: null,
  externalCompletedHours: null,
  externalRefreshedAt: null,
  stateDirty: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
  id: 'comment-1',
  taskId: 'task-1',
  body: 'original body',
  syncable: false,
  synced: false,
  externalId: null,
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  ...overrides,
});

const mockTaskContext = {
  tasks: [makeTask()],
  categories: [],
  selectedTaskId: 'task-1',
  filter: {},
  selectTask: vi.fn(),
  setFilter: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
  refreshTasks: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  refreshCategories: vi.fn(),
  refreshActiveTasks: vi.fn().mockResolvedValue(undefined),
  pendingTimeEntry: null,
  setPendingTimeEntry: vi.fn(),
};

const mockTimerContext = {
  activeEntry: null,
  elapsedSeconds: 0,
  totalTodaySeconds: 0,
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  isRunningForTask: vi.fn().mockReturnValue(false),
  refreshTodayTotal: vi.fn().mockResolvedValue(undefined),
  refreshActiveEntry: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => mockTaskContext,
}));

vi.mock('../../context/TimerContext', () => ({
  useTimerContext: () => mockTimerContext,
}));

describe('TaskDetail - comments & reported toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskContext.tasks = [makeTask()];
    mockTaskContext.selectedTaskId = 'task-1';
  });

  it('does not double-post a new comment when blur and the Add button both fire', async () => {
    const user = userEvent.setup();
    render(<TaskDetail />);
    await user.click(screen.getByText('Comments (0)'));

    const box = screen.getByPlaceholderText('Add a comment...');
    await user.type(box, 'hello world');

    // Clicking the button blurs the textarea (onBlur=handleAddComment) and then
    // fires the button's onClick (also handleAddComment) — the re-entrancy guard
    // must keep this to a single create.
    await user.click(screen.getByText('Add Comment'));

    await waitFor(() => {
      expect(window.api.comments.create as Mock).toHaveBeenCalledTimes(1);
    });
    expect(window.api.comments.create as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', body: 'hello world' }),
    );
  });

  it('edits an existing comment via comments.update on blur', async () => {
    (window.api.comments.getByTask as Mock).mockResolvedValue([makeComment()]);
    const user = userEvent.setup();
    render(<TaskDetail />);
    // Tab count reflects the async comment load.
    await user.click(await screen.findByText('Comments (1)'));

    // Click the comment body to enter edit mode.
    const body = await screen.findByText('original body');
    await user.click(body);

    const editor = screen.getByDisplayValue('original body');
    await user.clear(editor);
    await user.type(editor, 'edited body');
    // Blur to save.
    await user.tab();

    await waitFor(() => {
      expect(window.api.comments.update as Mock).toHaveBeenCalledWith(
        'comment-1',
        { body: 'edited body' },
      );
    });
  });

  it('"Unmark reported" invokes markTaskReported(taskId, null)', async () => {
    mockTaskContext.tasks = [makeTask({ totalTimeSeconds: 3600, hasUnreportedTime: false, unreportedTimeSeconds: 0 })];
    const user = userEvent.setup();
    render(<TaskDetail />);

    const btn = await screen.findByText('Unmark reported');
    await user.click(btn);

    await waitFor(() => {
      expect(window.api.timeEntries.markTaskReported as Mock).toHaveBeenCalledWith('task-1', null);
    });
  });
});
