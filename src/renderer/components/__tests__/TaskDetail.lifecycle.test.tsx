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

const mockUpdateTask = vi.fn().mockResolvedValue({});

const mockTaskContext = {
  tasks: [makeTask()],
  categories: [],
  selectedTaskId: 'task-1',
  filter: {},
  selectTask: vi.fn(),
  setFilter: vi.fn(),
  createTask: vi.fn(),
  updateTask: mockUpdateTask,
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

describe('TaskDetail - Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskContext.tasks = [makeTask()];
    mockTaskContext.selectedTaskId = 'task-1';
    mockTimerContext.isRunningForTask = vi.fn().mockReturnValue(false);
    mockTimerContext.stopTimer = vi.fn().mockResolvedValue(undefined);
    mockTimerContext.startTimer = vi.fn().mockResolvedValue(undefined);
    mockUpdateTask.mockResolvedValue({});
  });

  it('shows Complete button when status is not done', () => {
    render(<TaskDetail />);
    expect(screen.getByTitle('Mark as done')).toBeInTheDocument();
  });

  it('shows Reactivate button when status is done', () => {
    mockTaskContext.tasks = [makeTask({ status: 'done' })];
    render(<TaskDetail />);
    expect(screen.getByTitle('Reactivate task')).toBeInTheDocument();
  });

  it('Complete button calls updateTask with status done', async () => {
    const user = userEvent.setup();
    render(<TaskDetail />);
    await user.click(screen.getByTitle('Mark as done'));
    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', { status: 'done' });
  });

  it('Reactivate button calls updateTask with status todo', async () => {
    const user = userEvent.setup();
    mockTaskContext.tasks = [makeTask({ status: 'done' })];
    render(<TaskDetail />);
    await user.click(screen.getByTitle('Reactivate task'));
    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', { status: 'todo' });
  });

  it('Complete stops active timer before setting status', async () => {
    const user = userEvent.setup();
    mockTimerContext.isRunningForTask = vi.fn().mockReturnValue(true);
    render(<TaskDetail />);
    await user.click(screen.getByTitle('Mark as done'));
    expect(mockTimerContext.stopTimer).toHaveBeenCalled();
  });

  it('Reactivate starts timer for the task', async () => {
    const user = userEvent.setup();
    mockTaskContext.tasks = [makeTask({ status: 'done' })];
    render(<TaskDetail />);
    await user.click(screen.getByTitle('Reactivate task'));
    expect(mockTimerContext.startTimer).toHaveBeenCalledWith('task-1');
  });
});
