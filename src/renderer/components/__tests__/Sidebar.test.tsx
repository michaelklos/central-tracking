import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../Sidebar';

const mockTaskContext = {
  tasks: [],
  categories: [] as Record<string, unknown>[],
  selectedTaskId: null,
  filter: {} as Record<string, string | undefined>,
  selectTask: vi.fn(),
  setFilter: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
  refreshTasks: vi.fn(),
  createCategory: vi.fn().mockResolvedValue({ id: 'cat-1', name: 'Test' }),
  deleteCategory: vi.fn(),
  refreshCategories: vi.fn(),
  batchMode: false,
  enterBatchMode: vi.fn(),
};

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => mockTaskContext,
}));

describe('Sidebar', () => {
  beforeEach(() => {
    mockTaskContext.categories = [];
    mockTaskContext.filter = {};
    mockTaskContext.setFilter = vi.fn();
    mockTaskContext.createCategory = vi.fn().mockResolvedValue({ id: 'cat-1', name: 'Test' });
    localStorage.clear();
  });

  it('renders the app title', () => {
    render(<Sidebar />);
    expect(screen.getByText('Central Tracking')).toBeInTheDocument();
  });

  it('renders tab icons with correct titles', () => {
    render(<Sidebar />);
    expect(screen.getByTitle('Tasks')).toBeInTheDocument();
    expect(screen.getByTitle('Reports')).toBeInTheDocument();
    expect(screen.getByTitle('Settings')).toBeInTheDocument();
  });

  it('renders search input in Tasks tab', () => {
    render(<Sidebar />);
    expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument();
  });

  it('search input fires filter callback', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const searchInput = screen.getByPlaceholderText('Search tasks...');
    await user.type(searchInput, 'test');

    expect(mockTaskContext.setFilter).toHaveBeenCalled();
  });

  it('renders categories in Tasks tab', () => {
    mockTaskContext.categories = [
      { id: 'cat-1', name: 'Bug', color: '#ff0000', createdAt: '2024-01-01' },
      { id: 'cat-2', name: 'Feature', color: '#00ff00', createdAt: '2024-01-01' },
    ];

    render(<Sidebar />);
    expect(screen.getAllByText('Bug').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Feature').length).toBeGreaterThan(0);
  });

  it('Settings tab shows OptionsMenu', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Settings'));

    expect(screen.getByText('Auto-start timer on task creation')).toBeInTheDocument();
  });

  it('collapse hides content and title', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    expect(screen.getByText('Central Tracking')).toBeInTheDocument();

    const collapseBtn = screen.getByTitle('Collapse sidebar');
    await user.click(collapseBtn);

    expect(screen.queryByText('Central Tracking')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search tasks...')).not.toBeInTheDocument();
  });

  it('collapse state persists to localStorage', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByTitle('Collapse sidebar'));
    expect(localStorage.getItem('central-tracking:sidebar-collapsed')).toBe('true');
  });
});
