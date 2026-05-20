import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskList } from '../TaskList';
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

const mockTaskContext = {
  tasks: [] as Task[],
  activeTasks: [] as Task[],
  activeTasksTotal: 0,
  activeTasksHasMore: false,
  doneTasks: [] as Task[],
  doneTasksTotal: 0,
  doneTasksHasMore: false,
  doneTasksLoaded: false,
  categories: [],
  selectedTaskId: null,
  filter: {},
  selectTask: vi.fn(),
  setFilter: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
  refreshTasks: vi.fn(),
  refreshActiveTasks: vi.fn(),
  loadMoreActiveTasks: vi.fn(),
  loadDoneTasks: vi.fn().mockResolvedValue(undefined),
  loadMoreDoneTasks: vi.fn().mockResolvedValue(undefined),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  refreshCategories: vi.fn(),
  deletedTasks: [],
  deletedTasksTotal: 0,
  deletedTasksHasMore: false,
  deletedTasksLoaded: false,
  batchMode: false,
  selectedTaskIds: new Set<string>(),
  toggleTaskSelection: vi.fn(),
  selectAllTasks: vi.fn(),
  deselectAllTasks: vi.fn(),
  loadDeletedTasks: vi.fn().mockResolvedValue(undefined),
  loadMoreDeletedTasks: vi.fn().mockResolvedValue(undefined),
  restoreTask: vi.fn(),
  purgeTask: vi.fn(),
  emptyRecycleBin: vi.fn(),
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

describe('TaskList - Groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskContext.updateTask = vi.fn().mockResolvedValue({});
    mockTaskContext.loadDoneTasks = vi.fn().mockResolvedValue(undefined);
    mockTaskContext.doneTasksLoaded = false;
    mockTaskContext.activeTasks = [];
    mockTaskContext.doneTasks = [];
    mockTaskContext.doneTasksTotal = 0;
  });

  it('"Done" group renders last when grouped by status', () => {
    mockTaskContext.activeTasks = [
      makeTask({ id: '2', title: 'Todo Task', status: 'todo', sortOrder: 1 }),
      makeTask({ id: '3', title: 'In Progress Task', status: 'in-progress', sortOrder: 2 }),
    ];
    mockTaskContext.doneTasks = [
      makeTask({ id: '1', title: 'Done Task', status: 'done', sortOrder: 0 }),
    ];
    mockTaskContext.tasks = [...mockTaskContext.activeTasks, ...mockTaskContext.doneTasks];

    render(<TaskList />);

    const headers = screen.getAllByRole('heading', { level: 3 });
    const doneIdx = headers.findIndex((h) => h.textContent?.includes('Done'));
    expect(doneIdx).toBe(headers.length - 1);
  });

  it('"Done" group starts collapsed by default', () => {
    mockTaskContext.activeTasks = [
      makeTask({ id: '2', title: 'Todo Task', status: 'todo', sortOrder: 1 }),
    ];
    mockTaskContext.doneTasks = [
      makeTask({ id: '1', title: 'Done Task', status: 'done', sortOrder: 0 }),
    ];
    mockTaskContext.tasks = [...mockTaskContext.activeTasks, ...mockTaskContext.doneTasks];

    render(<TaskList />);
    // The done task should not be visible since Done is collapsed
    expect(screen.queryByText('Done Task')).not.toBeInTheDocument();
  });

  it('clicking Done group header expands it and triggers loadDoneTasks', async () => {
    const user = userEvent.setup();
    mockTaskContext.activeTasks = [
      makeTask({ id: '2', title: 'Todo Task', status: 'todo', sortOrder: 1 }),
    ];
    mockTaskContext.doneTasksTotal = 3;

    render(<TaskList />);

    // Click the Done header to expand
    const headers = screen.getAllByRole('heading', { level: 3 });
    const doneHeader = headers.find((h) => h.textContent?.includes('Done'));
    expect(doneHeader).toBeDefined();
    await user.click(doneHeader!);

    // loadDoneTasks should have been called since doneTasksLoaded is false
    expect(mockTaskContext.loadDoneTasks).toHaveBeenCalled();
  });

  it('clicking group header toggles collapse', async () => {
    const user = userEvent.setup();
    mockTaskContext.activeTasks = [
      makeTask({ id: '2', title: 'Todo Task', status: 'todo', sortOrder: 1 }),
    ];
    mockTaskContext.doneTasks = [
      makeTask({ id: '1', title: 'Done Task', status: 'done', sortOrder: 0 }),
    ];
    mockTaskContext.doneTasksLoaded = true;
    mockTaskContext.tasks = [...mockTaskContext.activeTasks, ...mockTaskContext.doneTasks];

    render(<TaskList />);

    // Done task should be hidden initially (collapsed)
    expect(screen.queryByText('Done Task')).not.toBeInTheDocument();

    // Click the Done header to expand
    const headers = screen.getAllByRole('heading', { level: 3 });
    const doneHeader = headers.find((h) => h.textContent?.includes('Done'));
    await user.click(doneHeader!);

    // Now Done task should be visible
    expect(screen.getByText('Done Task')).toBeInTheDocument();
  });

  it('Done group header shows total done count', () => {
    mockTaskContext.activeTasks = [
      makeTask({ id: '2', title: 'Todo Task', status: 'todo', sortOrder: 1 }),
    ];
    mockTaskContext.doneTasksTotal = 42;

    render(<TaskList />);

    const headers = screen.getAllByRole('heading', { level: 3 });
    const doneHeader = headers.find((h) => h.textContent?.includes('Done'));
    expect(doneHeader?.textContent).toContain('42');
  });

  it('inline checkmark button calls updateTask with status done', async () => {
    const user = userEvent.setup();
    mockTaskContext.activeTasks = [
      makeTask({ id: '1', title: 'Active Task', status: 'todo', sortOrder: 0 }),
    ];
    mockTaskContext.tasks = [...mockTaskContext.activeTasks];

    render(<TaskList />);

    const checkBtn = screen.getByTitle('Mark as done');
    await user.click(checkBtn);
    expect(mockTaskContext.updateTask).toHaveBeenCalledWith('1', { status: 'done' });
  });
});
