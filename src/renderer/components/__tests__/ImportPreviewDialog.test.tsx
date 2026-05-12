import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPreviewDialog } from '../ImportPreviewDialog';
import type { ImportPreviewItem, ImportError } from '../../../shared/types';

function makeItem(overrides: Partial<ImportPreviewItem> = {}): ImportPreviewItem {
  return {
    lineNumber: 1,
    title: 'Test Task',
    externalId: null,
    source: 'ad-hoc',
    pluginId: null,
    date: '2026-03-04',
    startTime: '09:00',
    durationSeconds: 3600,
    startDateTime: '2026-03-04T09:00:00.000Z',
    endDateTime: '2026-03-04T10:00:00.000Z',
    existingTask: null,
    action: 'create',
    ...overrides,
  };
}

const defaultProps = {
  items: [
    makeItem({ title: '[TK-101] Fix bug', externalId: 'TK-101', source: 'plugin', pluginId: 'jira' }),
    makeItem({ title: 'Meeting prep', startTime: '14:00', durationSeconds: 2700 }),
  ],
  errors: [] as ImportError[],
  filePath: '/home/user/tasks.md',
  onToggleAction: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('ImportPreviewDialog', () => {
  it('renders items in the table', () => {
    render(<ImportPreviewDialog {...defaultProps} />);
    expect(screen.getByText('[TK-101] Fix bug')).toBeInTheDocument();
    expect(screen.getByText('Meeting prep')).toBeInTheDocument();
  });

  it('shows create/skip summary', () => {
    render(<ImportPreviewDialog {...defaultProps} />);
    expect(screen.getByText(/2 to create/)).toBeInTheDocument();
  });

  it('shows file path', () => {
    render(<ImportPreviewDialog {...defaultProps} />);
    expect(screen.getByText('/home/user/tasks.md')).toBeInTheDocument();
  });

  it('calls onToggleAction when action button is clicked', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewDialog {...defaultProps} onToggleAction={onToggle} />);

    const buttons = screen.getAllByRole('button', { name: /create|skip/i });
    await user.click(buttons[0]);
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it('calls onConfirm when import button is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByText('Import 2 Tasks'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewDialog {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables confirm button when no items to create or update', () => {
    const items = defaultProps.items.map((i) => ({ ...i, action: 'skip' as const }));
    render(<ImportPreviewDialog {...defaultProps} items={items} />);

    const btn = screen.getByRole('button', { name: /Import/i });
    expect(btn).toBeDisabled();
  });

  it('shows existing badge for tasks with a match', () => {
    const items = [
      makeItem({
        title: '[TK-101] Fix bug',
        externalId: 'TK-101',
        existingTask: { id: 'abc', title: '[TK-101] Old task' },
        action: 'update',
      }),
    ];
    render(<ImportPreviewDialog {...defaultProps} items={items} />);
    expect(screen.getByText('existing')).toBeInTheDocument();
  });

  it('renders parse errors section', () => {
    const errors: ImportError[] = [
      { lineNumber: 5, line: '* bad line', reason: 'Malformed task line' },
    ];
    render(<ImportPreviewDialog {...defaultProps} errors={errors} />);
    expect(screen.getByText('Parse Errors')).toBeInTheDocument();
    expect(screen.getByText(/Malformed task line/)).toBeInTheDocument();
  });
});
