import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeEntryEditor } from '../TimeEntryEditor';
import type { TimeEntry } from '../../../shared/types';

const makeEntry = (overrides: Partial<TimeEntry> = {}): TimeEntry => ({
  id: 'te-1',
  taskId: 'task-1',
  startTime: '2024-06-15T09:00:00.000Z',
  endTime: '2024-06-15T10:30:00.000Z',
  durationSeconds: 5400,
  note: 'test note',
  createdAt: '2024-06-15T09:00:00.000Z',
  ...overrides,
});

describe('TimeEntryEditor - View Mode', () => {
  const defaultProps = {
    entry: makeEntry(),
    allEntries: [makeEntry()],
    onSave: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays date, time range, duration, and note in view mode', () => {
    render(<TimeEntryEditor {...defaultProps} />);
    expect(screen.getByText('test note')).toBeInTheDocument();
    // Duration should be formatted as HH:MM:SS
    expect(screen.getByText('01:30:00')).toBeInTheDocument();
  });

  it('enters edit mode when clicking the time range', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    // Click on the time range span (first "Click to edit" element)
    const clickables = screen.getAllByTitle('Click to edit');
    await user.click(clickables[0]);
    // Should now show edit inputs
    expect(screen.getByTestId('entry-date')).toBeInTheDocument();
    expect(screen.getByTestId('entry-start-time')).toBeInTheDocument();
    expect(screen.getByTestId('entry-duration')).toBeInTheDocument();
  });

  it('enters edit mode when clicking the duration', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    // Click on the duration span (second "Click to edit" element)
    const clickables = screen.getAllByTitle('Click to edit');
    await user.click(clickables[1]);
    expect(screen.getByTestId('entry-duration')).toBeInTheDocument();
  });

  it('shows delete button', () => {
    render(<TimeEntryEditor {...defaultProps} />);
    expect(screen.getByTitle('Delete entry')).toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    await user.click(screen.getByTitle('Delete entry'));
    expect(defaultProps.onDelete).toHaveBeenCalledWith('te-1');
  });
});

describe('TimeEntryEditor - Edit Mode', () => {
  const defaultProps = {
    entry: makeEntry(),
    allEntries: [makeEntry()],
    onSave: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fills date, start time, and duration when entering edit mode', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    await user.click(screen.getAllByTitle('Click to edit')[0]);

    const dateInput = screen.getByTestId('entry-date') as HTMLInputElement;
    const timeInput = screen.getByTestId('entry-start-time') as HTMLInputElement;
    const durationInput = screen.getByTestId('entry-duration') as HTMLInputElement;

    expect(dateInput.value).toBeTruthy();
    expect(timeInput.value).toBeTruthy();
    expect(durationInput.value).toBe('1h 30m');
  });

  it('shows computed end time', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    await user.click(screen.getAllByTitle('Click to edit')[0]);

    const endDisplay = screen.getByTestId('entry-end-time');
    expect(endDisplay.textContent).not.toBe('—');
  });

  it('shows Save and Cancel buttons in edit mode', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    await user.click(screen.getAllByTitle('Click to edit')[0]);

    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('cancels editing and returns to view mode', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    await user.click(screen.getAllByTitle('Click to edit')[0]);
    await user.click(screen.getByText('Cancel'));

    // Should be back in view mode - duration text visible, no form inputs
    expect(screen.getByText('01:30:00')).toBeInTheDocument();
    expect(screen.queryByTestId('entry-duration')).not.toBeInTheDocument();
  });

  it('validates invalid duration and shows error', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    await user.click(screen.getAllByTitle('Click to edit')[0]);

    const durationInput = screen.getByTestId('entry-duration');
    await user.clear(durationInput);
    await user.type(durationInput, 'abc');
    await user.click(screen.getByText('Save'));

    expect(screen.getByText(/Invalid duration/)).toBeInTheDocument();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with correct values when saving', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    await user.click(screen.getAllByTitle('Click to edit')[0]);

    // Change duration to 2h
    const durationInput = screen.getByTestId('entry-duration');
    await user.clear(durationInput);
    await user.type(durationInput, '2h');

    const noteInput = screen.getByTestId('entry-note');
    await user.clear(noteInput);
    await user.type(noteInput, 'updated note');

    await user.click(screen.getByText('Save'));

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      'te-1',
      expect.any(String),
      expect.any(String),
      'updated note'
    );
  });

  it('pre-fills note from existing entry', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);
    await user.click(screen.getAllByTitle('Click to edit')[0]);

    const noteInput = screen.getByTestId('entry-note') as HTMLInputElement;
    expect(noteInput.value).toBe('test note');
  });
});

describe('TimeEntryEditor - Create Mode', () => {
  const defaultProps = {
    mode: 'create' as const,
    allEntries: [] as TimeEntry[],
    onCreate: vi.fn().mockResolvedValue(undefined),
    defaultStartTime: '2024-06-15T10:30:00.000Z',
    defaultDurationSeconds: 1800,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders as an open form in create mode', () => {
    render(<TimeEntryEditor {...defaultProps} />);
    expect(screen.getByText('Add Entry')).toBeInTheDocument();
    expect(screen.getByTestId('entry-date')).toBeInTheDocument();
    expect(screen.getByTestId('entry-start-time')).toBeInTheDocument();
    expect(screen.getByTestId('entry-duration')).toBeInTheDocument();
  });

  it('shows "Add" button instead of "Save"', () => {
    render(<TimeEntryEditor {...defaultProps} />);
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('does not show Cancel button in create mode', () => {
    render(<TimeEntryEditor {...defaultProps} />);
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('pre-fills with default duration of 30m', () => {
    render(<TimeEntryEditor {...defaultProps} />);
    const durationInput = screen.getByTestId('entry-duration') as HTMLInputElement;
    expect(durationInput.value).toBe('30m');
  });

  it('shows computed end time based on defaults', () => {
    render(<TimeEntryEditor {...defaultProps} />);
    const endDisplay = screen.getByTestId('entry-end-time');
    expect(endDisplay.textContent).not.toBe('—');
  });

  it('calls onCreate with correct values when adding', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);

    await user.click(screen.getByText('Add'));

    expect(defaultProps.onCreate).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      '' // empty note
    );
  });

  it('validates invalid duration in create mode', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);

    const durationInput = screen.getByTestId('entry-duration');
    await user.clear(durationInput);
    await user.type(durationInput, 'xyz');
    await user.click(screen.getByText('Add'));

    expect(screen.getByText(/Invalid duration/)).toBeInTheDocument();
    expect(defaultProps.onCreate).not.toHaveBeenCalled();
  });

  it('resets note field after successful creation', async () => {
    const user = userEvent.setup();
    render(<TimeEntryEditor {...defaultProps} />);

    const noteInput = screen.getByTestId('entry-note');
    await user.type(noteInput, 'my note');
    await user.click(screen.getByText('Add'));

    // After creation, note should be reset
    expect((screen.getByTestId('entry-note') as HTMLInputElement).value).toBe('');
  });
});
