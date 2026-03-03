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
  });

  it('renders the app title', () => {
    render(<Sidebar />);
    expect(screen.getByText('Central Tracking')).toBeInTheDocument();
  });

  it('renders search input', () => {
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

  it('renders categories', () => {
    mockTaskContext.categories = [
      { id: 'cat-1', name: 'Bug', color: '#ff0000', createdAt: '2024-01-01' },
      { id: 'cat-2', name: 'Feature', color: '#00ff00', createdAt: '2024-01-01' },
    ];

    render(<Sidebar />);
    // Category names appear in both the list and dropdown, so use getAllByText
    expect(screen.getAllByText('Bug').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Feature').length).toBeGreaterThan(0);
  });

  it('creates a new category', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const input = screen.getByPlaceholderText('New category...');
    await user.type(input, 'New Cat');
    await user.click(screen.getByText('+'));

    expect(mockTaskContext.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Cat' })
    );
  });
});
