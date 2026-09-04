import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskProvider } from '../TaskContext';
import { TimerProvider, useTimerContext } from '../TimerContext';

function Consumer() {
  const { startTimer } = useTimerContext();
  return <button data-testid="start" onClick={() => startTimer('t1')}>start</button>;
}

function renderTimer() {
  render(
    <TaskProvider>
      <TimerProvider>
        <Consumer />
      </TimerProvider>
    </TaskProvider>
  );
}

describe('TimerContext — starting a timer promotes a to-do', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api.timeEntries.create = vi.fn().mockResolvedValue(
      { id: 'e1', taskId: 't1', startTime: '2026-09-03T10:00:00.000Z', endTime: null }
    ) as never;
  });

  it('moves a to-do to in-progress through updateTask, so the ADO FSM runs and state_dirty is set', async () => {
    const user = userEvent.setup();
    window.api.tasks.getById = vi.fn().mockResolvedValue({ id: 't1', status: 'todo' }) as never;
    renderTimer();

    await user.click(screen.getByTestId('start'));

    await waitFor(() => expect(window.api.tasks.update).toHaveBeenCalledWith('t1', { status: 'in-progress' }));
  });

  it('leaves a task that is already in progress alone', async () => {
    const user = userEvent.setup();
    window.api.tasks.getById = vi.fn().mockResolvedValue({ id: 't1', status: 'in-progress' }) as never;
    renderTimer();

    await user.click(screen.getByTestId('start'));

    await waitFor(() => expect(window.api.timeEntries.create).toHaveBeenCalled());
    expect(window.api.tasks.update).not.toHaveBeenCalled();
  });

  it('does not resurrect a done task when time is logged against it', async () => {
    const user = userEvent.setup();
    window.api.tasks.getById = vi.fn().mockResolvedValue({ id: 't1', status: 'done' }) as never;
    renderTimer();

    await user.click(screen.getByTestId('start'));

    await waitFor(() => expect(window.api.timeEntries.create).toHaveBeenCalled());
    expect(window.api.tasks.update).not.toHaveBeenCalled();
  });
});
