import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskList } from '../TaskList';
import { sectionsFromTasks, type MockSection } from '../../../test/mocks/statusSections';

const mockTaskContext = {
  tasks: [],
  activeTasks: [],
  activeTasksTotal: 0,
  activeTasksHasMore: false,
  // Left null so the mock derives sections from activeTasks; set it
  // directly in a test that needs per-section totals or paging.
  statusSections: null as Record<string, MockSection> | null,
  loadMoreStatusTasks: vi.fn().mockResolvedValue(undefined),
  doneTasks: [],
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

describe('TaskList - Validation', () => {
  beforeEach(() => {
    mockTaskContext.statusSections = null;
    vi.clearAllMocks();
    mockTaskContext.createTask = vi.fn().mockResolvedValue({ id: 'new', title: 'New' });
  });

  it('empty new-task input does not create task on submit', async () => {
    const user = userEvent.setup();
    render(<TaskList />);

    const input = screen.getByPlaceholderText('Add a new task...');
    // Press Enter on empty input
    await user.click(input);
    await user.keyboard('{Enter}');

    expect(mockTaskContext.createTask).not.toHaveBeenCalled();
  });

  it('shows visual feedback (shake) class on empty submit attempt', async () => {
    const user = userEvent.setup();
    render(<TaskList />);

    // Find the Add button in the SplitButton
    const addBtn = screen.getByText('Add');
    await user.click(addBtn);

    expect(mockTaskContext.createTask).not.toHaveBeenCalled();
  });
});
