import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskList } from '../TaskList';
import { sectionsFromTasks, type MockSection } from '../../../test/mocks/statusSections';

const mockTaskContext = {
  tasks: [] as Record<string, unknown>[],
  activeTasks: [] as Record<string, unknown>[],
  activeTasksTotal: 0,
  activeTasksHasMore: false,
  // Left null so the mock derives sections from activeTasks; set it
  // directly in a test that needs per-section totals or paging.
  statusSections: null as Record<string, MockSection> | null,
  loadMoreStatusTasks: vi.fn().mockResolvedValue(undefined),
  doneTasks: [] as Record<string, unknown>[],
  doneTasksTotal: 0,
  doneTasksHasMore: false,
  doneTasksLoaded: false,
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
  refreshActiveTasks: vi.fn(),
  loadMoreActiveTasks: vi.fn(),
  loadDoneTasks: vi.fn().mockResolvedValue(undefined),
  loadMoreDoneTasks: vi.fn().mockResolvedValue(undefined),
  deletedTasks: [],
  deletedTasksTotal: 0,
  deletedTasksHasMore: false,
  deletedTasksLoaded: false,
  batchMode: false,
  selectedTaskIds: new Set<string>(),
  toggleTaskSelection: vi.fn(),
  selectAllTasks: vi.fn(),
  deselectAllTasks: vi.fn(),
  selectAllActiveTasks: vi.fn().mockResolvedValue(undefined),
  loadDeletedTasks: vi.fn().mockResolvedValue(undefined),
  loadMoreDeletedTasks: vi.fn().mockResolvedValue(undefined),
  restoreTask: vi.fn(),
  purgeTask: vi.fn(),
  emptyRecycleBin: vi.fn(),
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

// The literal is inline because a vi.mock factory is hoisted above imports.
vi.mock('../../context/TaskContext', () => ({
  SECTION_STATUSES: ['todo', 'in-progress', 'blocked'],
  useTaskContext: () => ({
    ...mockTaskContext,
    statusSections: mockTaskContext.statusSections ?? sectionsFromTasks(mockTaskContext.activeTasks),
  }),
}));

vi.mock('../../context/TimerContext', () => ({
  useTimerContext: () => mockTimerContext,
  useElapsedSeconds: () => mockTimerContext.elapsedSeconds,
}));

describe('TaskList - context menu', () => {
  beforeEach(() => {
    mockTaskContext.statusSections = null;
    vi.clearAllMocks();
    localStorage.clear();
    mockTaskContext.activeTasks = [{ id: 't1', title: 'Right click me', status: 'todo', source: 'ad-hoc', categoryIds: [], pluginId: null }];
    mockTaskContext.tasks = [...mockTaskContext.activeTasks];
    mockTaskContext.batchMode = false;
  });

  it('opens on right-click over a task row', async () => {
    const user = userEvent.setup();
    render(<TaskList />);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Right click me') });

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('stays out of the way in batch mode, where right-click is not a selection', async () => {
    const user = userEvent.setup();
    mockTaskContext.batchMode = true;
    render(<TaskList />);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Right click me') });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('TaskList', () => {
  beforeEach(() => {
    mockTaskContext.statusSections = null;
    mockTaskContext.batchMode = false;
    mockTaskContext.activeTasks = [];
    mockTaskContext.doneTasks = [];
    mockTaskContext.tasks = [];
    mockTaskContext.doneTasksTotal = 0;
    mockTaskContext.createTask = vi.fn().mockResolvedValue({ id: 'new', title: 'New' });
  });

  it('shows empty state when no tasks', () => {
    render(<TaskList />);
    expect(screen.getByText(/No tasks found/)).toBeInTheDocument();
  });

  it('renders task items from activeTasks', () => {
    const task = {
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
      notes: '',
      deletedAt: null,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };
    mockTaskContext.activeTasks = [task];
    mockTaskContext.tasks = [task];

    render(<TaskList />);
    expect(screen.getByText('Task 1')).toBeInTheDocument();
  });

  it('creates a task when form is submitted', async () => {
    const user = userEvent.setup();
    render(<TaskList />);

    const input = screen.getByPlaceholderText('Add a new task...');
    await user.type(input, 'New Task');
    await user.click(screen.getByText('Add'));

    expect(mockTaskContext.createTask).toHaveBeenCalledWith({ title: 'New Task', status: 'in-progress' });
  });

  it('does not create task with empty title', async () => {
    const user = userEvent.setup();
    render(<TaskList />);

    await user.click(screen.getByText('Add'));
    expect(mockTaskContext.createTask).not.toHaveBeenCalled();
  });
});
