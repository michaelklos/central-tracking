import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReportView } from '../ReportView';

vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Legend: () => <div />,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => <div />,
  Cell: () => <div />,
}));

const mockReportContext = {
  mode: 'chart' as const,
  setMode: vi.fn(),
  startDate: '2026-03-01',
  endDate: '2026-03-07',
  setDateRange: vi.fn(),
  filterStatuses: [] as string[],
  setFilterStatuses: vi.fn(),
  filterSources: [] as string[],
  setFilterSources: vi.fn(),
  filterCategories: [] as string[],
  setFilterCategories: vi.fn(),
};

vi.mock('../../context/ReportContext', () => ({
  useReportContext: () => mockReportContext,
}));

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => ({
    categories: [],
  }),
}));

describe('ReportView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReportContext.mode = 'chart';
    (window.api.timeEntries.getReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (window.api.timeEntries.getSummaryReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders chart area in chart mode', () => {
    render(<ReportView />);
    expect(screen.getByText('Time Report')).toBeInTheDocument();
    expect(screen.getByTestId('report-chart')).toBeInTheDocument();
  });

  it('renders Export CSV button in chart mode', () => {
    render(<ReportView />);
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });

  it('shows empty message when no data', () => {
    render(<ReportView />);
    expect(screen.getByText('No data for the selected date range.')).toBeInTheDocument();
  });

  it('renders summary mode', () => {
    mockReportContext.mode = 'summary' as typeof mockReportContext.mode;
    render(<ReportView />);
    expect(screen.getByTestId('summary-preview')).toBeInTheDocument();
    expect(screen.getByText('Copy to Clipboard')).toBeInTheDocument();
  });

  it('renders categories mode with pie charts', () => {
    mockReportContext.mode = 'categories' as typeof mockReportContext.mode;
    render(<ReportView />);
    expect(screen.getByTestId('category-pie-charts')).toBeInTheDocument();
  });
});
