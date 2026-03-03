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
}));

describe('ReportView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.api.timeEntries.getReport as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders DateRangePicker and chart area', () => {
    render(<ReportView />);
    expect(screen.getByText('Time Report')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument(); // DateRangePicker preset
    expect(screen.getByTestId('report-chart')).toBeInTheDocument();
  });

  it('renders Export CSV button', () => {
    render(<ReportView />);
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });

  it('shows empty message when no data', () => {
    render(<ReportView />);
    expect(screen.getByText('No data for the selected date range.')).toBeInTheDocument();
  });
});
