import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportProvider, useReportContext } from '../ReportContext';

function TestConsumer() {
  const ctx = useReportContext();
  return (
    <div>
      <span data-testid="mode">{ctx.mode}</span>
      <span data-testid="start">{ctx.startDate}</span>
      <span data-testid="end">{ctx.endDate}</span>
      <span data-testid="status">{ctx.filterStatus}</span>
      <span data-testid="source">{ctx.filterSource}</span>
      <span data-testid="cats">{ctx.filterCategories.join(',')}</span>
      <button data-testid="set-summary" onClick={() => ctx.setMode('summary')}>Summary</button>
      <button data-testid="set-categories" onClick={() => ctx.setMode('categories')}>Categories</button>
      <button data-testid="set-dates" onClick={() => ctx.setDateRange('2026-01-01', '2026-01-31')}>Set Dates</button>
      <button data-testid="set-status" onClick={() => ctx.setFilterStatus('done')}>Set Status</button>
      <button data-testid="set-source" onClick={() => ctx.setFilterSource('email')}>Set Source</button>
      <button data-testid="toggle-cat" onClick={() => ctx.toggleCategoryFilter('cat-1')}>Toggle Cat</button>
    </div>
  );
}

describe('ReportContext', () => {
  it('provides default values', () => {
    render(
      <ReportProvider>
        <TestConsumer />
      </ReportProvider>
    );
    expect(screen.getByTestId('mode').textContent).toBe('chart');
    expect(screen.getByTestId('status').textContent).toBe('');
    expect(screen.getByTestId('source').textContent).toBe('');
    expect(screen.getByTestId('cats').textContent).toBe('');
  });

  it('changes mode', async () => {
    const user = userEvent.setup();
    render(
      <ReportProvider>
        <TestConsumer />
      </ReportProvider>
    );
    await user.click(screen.getByTestId('set-summary'));
    expect(screen.getByTestId('mode').textContent).toBe('summary');
    await user.click(screen.getByTestId('set-categories'));
    expect(screen.getByTestId('mode').textContent).toBe('categories');
  });

  it('changes date range', async () => {
    const user = userEvent.setup();
    render(
      <ReportProvider>
        <TestConsumer />
      </ReportProvider>
    );
    await user.click(screen.getByTestId('set-dates'));
    expect(screen.getByTestId('start').textContent).toBe('2026-01-01');
    expect(screen.getByTestId('end').textContent).toBe('2026-01-31');
  });

  it('changes filters', async () => {
    const user = userEvent.setup();
    render(
      <ReportProvider>
        <TestConsumer />
      </ReportProvider>
    );
    await user.click(screen.getByTestId('set-status'));
    expect(screen.getByTestId('status').textContent).toBe('done');
    await user.click(screen.getByTestId('set-source'));
    expect(screen.getByTestId('source').textContent).toBe('email');
  });

  it('toggles category filter', async () => {
    const user = userEvent.setup();
    render(
      <ReportProvider>
        <TestConsumer />
      </ReportProvider>
    );
    await user.click(screen.getByTestId('toggle-cat'));
    expect(screen.getByTestId('cats').textContent).toBe('cat-1');
    await user.click(screen.getByTestId('toggle-cat'));
    expect(screen.getByTestId('cats').textContent).toBe('');
  });

  it('throws when used outside provider', () => {
    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useReportContext must be used within a ReportProvider');
  });
});
