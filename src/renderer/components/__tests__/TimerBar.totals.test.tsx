import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimerBar } from '../TimerBar';

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

describe('TimerBar - Today Totals', () => {
  beforeEach(() => {
    mockTimerContext.activeEntry = null;
    mockTimerContext.elapsedSeconds = 0;
    mockTimerContext.totalTodaySeconds = 0;
    mockTaskContext.tasks = [];
  });

  it('displays "Today: 00:00:00" when totalTodaySeconds is 0', () => {
    render(<TimerBar />);
    expect(screen.getByText(/Today:/)).toBeInTheDocument();
    expect(screen.getByText('00:00:00')).toBeInTheDocument();
  });

  it('displays formatted total when totalTodaySeconds > 0', () => {
    mockTimerContext.totalTodaySeconds = 3661;
    render(<TimerBar />);
    expect(screen.getByText('01:01:01')).toBeInTheDocument();
  });
});
