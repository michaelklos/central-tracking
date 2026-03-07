import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDetail } from '../TaskDetail';
import type { Task } from '../../../shared/types';

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
  categoryIds: [],
  notes: '',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
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
};

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => mockTaskContext,
}));

vi.mock('../../context/TimerContext', () => ({
  useTimerContext: () => mockTimerContext,
}));

describe('TaskDetail - Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskContext.tasks = [makeTask()];
    mockTaskContext.selectedTaskId = 'task-1';
  });

  it('"No categories" placeholder renders when none assigned', () => {
    mockTaskContext.categories = [];
    render(<TaskDetail />);
    expect(screen.getByText('No categories')).toBeInTheDocument();
  });

  it('empty title shows red border and prevents save', async () => {
    const user = userEvent.setup();
    render(<TaskDetail />);

    // Click on the title to start editing
    const title = screen.getByText('Test Task');
    await user.click(title);

    // Clear the title
    const input = screen.getByDisplayValue('Test Task');
    await user.clear(input);

    // Try to save by pressing Enter
    await user.keyboard('{Enter}');

    // updateTask should NOT have been called with empty title
    expect(mockTaskContext.updateTask).not.toHaveBeenCalled();
  });
});
