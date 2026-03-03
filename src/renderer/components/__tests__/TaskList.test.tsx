import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskList } from '../TaskList';

const mockTaskContext = {
  tasks: [] as Record<string, unknown>[],
  categories: [],
  selectedTaskId: null,
  filter: {},
  selectTask: vi.fn(),
  setFilter: vi.fn(),
  createTask: vi.fn().mockResolvedValue({ id: 'new', title: 'New' }),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
  refreshTasks: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  refreshCategories: vi.fn(),
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

describe('TaskList', () => {
  beforeEach(() => {
    mockTaskContext.tasks = [];
    mockTaskContext.createTask = vi.fn().mockResolvedValue({ id: 'new', title: 'New' });
  });

  it('shows empty state when no tasks', () => {
    render(<TaskList />);
    expect(screen.getByText(/No tasks found/)).toBeInTheDocument();
  });

  it('renders task items', () => {
    mockTaskContext.tasks = [
      {
        id: '1',
        title: 'Task 1',
        description: '',
        status: 'todo',
        source: 'ad-hoc',
        externalId: null,
        pluginId: null,
        sortOrder: 0,
        totalTimeSeconds: 0,
        todayTimeSeconds: 0,
        categoryIds: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      },
    ];

    render(<TaskList />);
    expect(screen.getByText('Task 1')).toBeInTheDocument();
  });

  it('creates a task when form is submitted', async () => {
    const user = userEvent.setup();
    render(<TaskList />);

    const input = screen.getByPlaceholderText('Add a new task...');
    await user.type(input, 'New Task');
    await user.click(screen.getByText('Add'));

    expect(mockTaskContext.createTask).toHaveBeenCalledWith({ title: 'New Task' });
  });

  it('does not create task with empty title', async () => {
    const user = userEvent.setup();
    render(<TaskList />);

    await user.click(screen.getByText('Add'));
    expect(mockTaskContext.createTask).not.toHaveBeenCalled();
  });
});
