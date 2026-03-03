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

describe('TaskDetail - Notes Tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskContext.tasks = [makeTask()];
    mockTaskContext.selectedTaskId = 'task-1';
    mockTaskContext.updateTask = vi.fn().mockResolvedValue({});
  });

  it('"Notes" tab exists in tab bar', () => {
    render(<TaskDetail />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('tab label shows "Notes*" when task has notes', () => {
    mockTaskContext.tasks = [makeTask({ notes: 'Some notes' })];
    render(<TaskDetail />);
    expect(screen.getByText('Notes*')).toBeInTheDocument();
  });

  it('tab content shows notes textarea', async () => {
    const user = userEvent.setup();
    render(<TaskDetail />);
    await user.click(screen.getByText('Notes'));
    expect(screen.getByPlaceholderText('Add notes...')).toBeInTheDocument();
  });
});
