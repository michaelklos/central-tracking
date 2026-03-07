import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryPieCharts } from '../CategoryPieCharts';
import type { Category } from '../../../shared/types';

vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => <div data-testid="pie" />,
  Cell: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockCategories: Category[] = [
  { id: 'cat-1', name: 'Development', color: '#6366f1', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'cat-2', name: 'Meetings', color: '#22c55e', createdAt: '2026-01-01T00:00:00Z' },
];

describe('CategoryPieCharts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.api.timeEntries.getSummaryReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders 3 panels', () => {
    render(<CategoryPieCharts categories={mockCategories} />);
    expect(screen.getByTestId('pie-panel-0')).toBeInTheDocument();
    expect(screen.getByTestId('pie-panel-1')).toBeInTheDocument();
    expect(screen.getByTestId('pie-panel-2')).toBeInTheDocument();
  });

  it('renders panel labels', () => {
    render(<CategoryPieCharts categories={mockCategories} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Past 7 Days')).toBeInTheDocument();
    expect(screen.getByText('Past 30 Days')).toBeInTheDocument();
  });

  it('shows "No data" when no entries', () => {
    render(<CategoryPieCharts categories={mockCategories} />);
    const empties = screen.getAllByText('No data');
    expect(empties.length).toBe(3);
  });

  it('renders category filter chips', () => {
    render(<CategoryPieCharts categories={mockCategories} />);
    expect(screen.getByText('Development')).toBeInTheDocument();
    expect(screen.getByText('Meetings')).toBeInTheDocument();
  });

  it('toggles category filter chip on click', async () => {
    const user = userEvent.setup();
    render(<CategoryPieCharts categories={mockCategories} />);
    const devChip = screen.getByText('Development');
    await user.click(devChip);
    expect(devChip.closest('button')).toHaveClass('category-pie-charts__chip--active');
  });

  it('shows custom dates toggle', async () => {
    const user = userEvent.setup();
    render(<CategoryPieCharts categories={mockCategories} />);
    const toggleBtns = screen.getAllByText('Custom dates');
    expect(toggleBtns.length).toBe(3);
    await user.click(toggleBtns[0]);
    expect(screen.getByText('Hide dates')).toBeInTheDocument();
  });

  it('renders with empty categories', () => {
    render(<CategoryPieCharts categories={[]} />);
    expect(screen.getByTestId('category-pie-charts')).toBeInTheDocument();
  });

  it('renders pie charts when data is available', async () => {
    (window.api.timeEntries.getSummaryReport as ReturnType<typeof vi.fn>).mockResolvedValue([
      { date: '2026-03-07', taskId: 't1', taskTitle: 'Task', taskSource: 'ad-hoc', taskStatus: 'todo', categoryIds: ['cat-1'], totalSeconds: 3600 },
    ]);

    render(<CategoryPieCharts categories={mockCategories} />);

    // Wait for data to load
    await screen.findAllByText('Development');
    // Should find legend rows with the category name
    const legends = screen.getAllByText('Development');
    expect(legends.length).toBeGreaterThanOrEqual(1);
  });
});
