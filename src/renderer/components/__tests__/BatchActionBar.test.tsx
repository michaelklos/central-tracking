import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchActionBar } from '../BatchActionBar';
import { createMockApi } from '../../../test/mocks/api';

// Mock TaskContext
const mockContext = {
  tasks: [
    { id: 'task-1', pluginId: null, title: 'A', source: 'ad-hoc' },
    { id: 'task-2', pluginId: null, title: 'B', source: 'ad-hoc' },
  ],
  selectedTaskIds: new Set(['task-1', 'task-2']),
  exitBatchMode: vi.fn(),
  batchUpdateTasks: vi.fn(),
  batchDeleteTasks: vi.fn(),
  batchMarkSelectedReported: vi.fn().mockResolvedValue({ changed: 0 }),
  categories: [
    { id: 'cat-1', name: 'Bug', color: '#ff0000', createdAt: '2026-01-01' },
  ],
};

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => mockContext,
}));

describe('BatchActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockApi() as never;
  });

  it('shows selected task count', () => {
    render(<BatchActionBar />);
    expect(screen.getByText('2 tasks selected')).toBeInTheDocument();
  });

  it('renders status, source, and category dropdowns', () => {
    render(<BatchActionBar />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(3); // status, source, category
  });

  it('calls exitBatchMode when Cancel clicked', async () => {
    render(<BatchActionBar />);
    await userEvent.click(screen.getByText('Cancel'));
    expect(mockContext.exitBatchMode).toHaveBeenCalledTimes(1);
  });

  it('Apply is disabled when no changes selected', () => {
    render(<BatchActionBar />);
    const applyBtn = screen.getByText('Apply Changes');
    expect(applyBtn).toBeDisabled();
  });

  it('calls batchUpdateTasks when Apply clicked with status change', async () => {
    render(<BatchActionBar />);
    const selects = screen.getAllByRole('combobox');
    // First select is status
    await userEvent.selectOptions(selects[0], 'in-progress');
    await userEvent.click(screen.getByText('Apply Changes'));
    expect(mockContext.batchUpdateTasks).toHaveBeenCalledWith({ status: 'in-progress' });
  });

  it('shows confirm dialog before batch delete', async () => {
    render(<BatchActionBar />);
    await userEvent.click(screen.getByText('Delete Selected'));
    expect(screen.getByText('Delete Tasks')).toBeInTheDocument();
  });

  it('calls batchDeleteTasks after confirming delete', async () => {
    render(<BatchActionBar />);
    await userEvent.click(screen.getByText('Delete Selected'));
    await userEvent.click(screen.getByText('Delete'));
    expect(mockContext.batchDeleteTasks).toHaveBeenCalledTimes(1);
  });
});
