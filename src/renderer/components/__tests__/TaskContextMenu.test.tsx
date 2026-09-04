import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskContextMenu } from '../TaskContextMenu';
import { createMockApi } from '../../../test/mocks/api';
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
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const mockContext = {
  updateTask: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  categories: [
    { id: 'cat-1', name: 'Bug', color: '#ff0000', createdAt: '2026-01-01' },
  ],
};

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => mockContext,
}));

function renderMenu(task = makeTask(), onClose = vi.fn()) {
  render(<TaskContextMenu target={{ task, x: 10, y: 10 }} onClose={onClose} />);
  return onClose;
}

describe('TaskContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.updateTask = vi.fn().mockResolvedValue({});
    mockContext.deleteTask = vi.fn().mockResolvedValue(undefined);
    window.api = createMockApi() as never;
  });

  it('sets a status and closes', async () => {
    const user = userEvent.setup();
    const onClose = renderMenu();

    await user.click(screen.getByText('In Progress'));

    expect(mockContext.updateTask).toHaveBeenCalledWith('task-1', { status: 'in-progress' });
    expect(onClose).toHaveBeenCalled();
  });

  it('adds a category the task does not have', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByText('Bug'));
    expect(mockContext.updateTask).toHaveBeenCalledWith('task-1', { categoryIds: ['cat-1'] });
  });

  it('removes a category the task already has', async () => {
    const user = userEvent.setup();
    renderMenu(makeTask({ categoryIds: ['cat-1'] }));
    await user.click(screen.getByText('Bug'));
    expect(mockContext.updateTask).toHaveBeenCalledWith('task-1', { categoryIds: [] });
  });

  it('deletes the task', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByText('Delete'));
    expect(mockContext.deleteTask).toHaveBeenCalledWith('task-1');
  });

  it('offers only the legal transitions for an ADO task', () => {
    renderMenu(makeTask({ source: 'plugin', pluginId: 'ado', status: 'in-progress' }));
    // in-progress → done or blocked; never back to to-do.
    expect(screen.queryByText('To Do')).not.toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('keeps the menu open and shows why when a status change is rejected', async () => {
    const user = userEvent.setup();
    mockContext.updateTask = vi.fn().mockRejectedValue(new Error('INVALID_ADO_TRANSITION'));
    const onClose = renderMenu();

    await user.click(screen.getByText('Done'));

    expect(await screen.findByRole('alert')).toHaveTextContent('INVALID_ADO_TRANSITION');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = renderMenu();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
