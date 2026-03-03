import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimerBar } from '../TimerBar';

const mockTimerContext = {
  activeEntry: null,
  elapsedSeconds: 0,
  totalTodaySeconds: 0,
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  isRunningForTask: vi.fn().mockReturnValue(false),
};

const mockTaskContext = {
  tasks: [],
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

describe('TimerBar - Pin/Always on Top', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.api.window.getAlwaysOnTop as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  });

  it('pin button renders', () => {
    render(<TimerBar />);
    expect(screen.getByTitle(/pin/i)).toBeInTheDocument();
  });

  it('clicking pin toggles always-on-top', async () => {
    const user = userEvent.setup();
    render(<TimerBar />);
    const pinBtn = screen.getByTitle(/pin/i);
    await user.click(pinBtn);
    expect(window.api.window.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
