import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimerBar } from '../TimerBar';

// Mock the contexts
const mockTimerContext = {
  activeEntry: null as Record<string, unknown> | null,
  elapsedSeconds: 0,
  totalTodaySeconds: 0,
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  isRunningForTask: vi.fn().mockReturnValue(false),
};

const mockTaskContext = {
  tasks: [] as Record<string, unknown>[],
  categories: [],
  selectedTaskId: null,
  filter: {},
  selectTask: vi.fn(),
  setFilter: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
  refreshTasks: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  refreshCategories: vi.fn(),
};

vi.mock('../../context/TimerContext', () => ({
  useTimerContext: () => mockTimerContext,
}));

vi.mock('../../context/TaskContext', () => ({
  useTaskContext: () => mockTaskContext,
}));

describe('TimerBar', () => {
  beforeEach(() => {
    mockTimerContext.activeEntry = null;
    mockTimerContext.elapsedSeconds = 0;
    mockTimerContext.stopTimer = vi.fn();
    mockTaskContext.tasks = [];
  });

  it('shows "No timer running" when no timer is active', () => {
    render(<TimerBar />);
    expect(screen.getByText('No timer running')).toBeInTheDocument();
  });

  it('shows task name and elapsed time when timer is active', () => {
    mockTimerContext.activeEntry = { id: 'entry-1', taskId: 'task-1', startTime: new Date().toISOString() };
    mockTimerContext.elapsedSeconds = 125;
    mockTaskContext.tasks = [{ id: 'task-1', title: 'My Active Task' }];

    render(<TimerBar />);
    expect(screen.getByText('My Active Task')).toBeInTheDocument();
    // Elapsed time appears in the timer-bar__elapsed element
    const elapsed = document.querySelector('.timer-bar__elapsed');
    expect(elapsed?.textContent).toBe('00:02:05');
  });

  it('shows stop button when timer is active', async () => {
    mockTimerContext.activeEntry = { id: 'entry-1', taskId: 'task-1', startTime: new Date().toISOString() };
    mockTaskContext.tasks = [{ id: 'task-1', title: 'Task' }];

    render(<TimerBar />);
    const stopBtn = screen.getByText('Stop');
    expect(stopBtn).toBeInTheDocument();

    await userEvent.click(stopBtn);
    expect(mockTimerContext.stopTimer).toHaveBeenCalled();
  });

  it('does not show stop button when timer is inactive', () => {
    render(<TimerBar />);
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
  });

  it('today display shows totalTodaySeconds when no timer is active', () => {
    mockTimerContext.totalTodaySeconds = 3661;
    render(<TimerBar />);
    const today = document.querySelector('.timer-bar__today');
    expect(today?.textContent).toBe('Today: 01:01:01');
  });

  it('today display adds elapsedSeconds when timer is active', () => {
    mockTimerContext.activeEntry = { id: 'e1', taskId: 't1', startTime: new Date().toISOString() };
    mockTimerContext.totalTodaySeconds = 100;
    mockTimerContext.elapsedSeconds = 23;
    render(<TimerBar />);
    const today = document.querySelector('.timer-bar__today');
    expect(today?.textContent).toBe('Today: 00:02:03');
  });
});
