import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

/**
 * A running entry has no end_time, so its duration is not final and nothing
 * that sums time to push to an external system counts it. Marking it reported
 * would retire it before its time ever left ct.
 */
describe('markTaskReported - running entries', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;
  let taskIpc: ReturnType<typeof createMockIpcMain>;
  let taskId: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    taskIpc = createMockIpcMain();
    registerTimeEntryHandlers(ipc as never, db);
    registerTaskHandlers(taskIpc as never, db);
    const task = await taskIpc.invoke('tasks:create', { title: 'Push Task' });
    taskId = task.id;
  });

  afterEach(() => db.close());

  it('leaves the running entry unreported while marking the completed one', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });
    // No endTime: this is the singleton running timer.
    const running = await ipc.invoke('timeEntries:create', {
      taskId,
      startTime: '2024-01-15T11:00:00Z',
    });
    expect(running.endTime).toBeNull();

    const res = await ipc.invoke('timeEntries:markTaskReported', taskId, '2024-01-16T00:00:00Z');
    expect(res.changed).toBe(1);

    const entries = await ipc.invoke('timeEntries:getByTask', taskId);
    const stillRunning = entries.find((e: { id: string }) => e.id === running.id);
    expect(stillRunning.reportedAt).toBeNull();
    const completed = entries.find((e: { id: string }) => e.id !== running.id);
    expect(completed.reportedAt).toBe('2024-01-16T00:00:00Z');
  });

  it('batchMarkReported also skips the running entry', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });
    const running = await ipc.invoke('timeEntries:create', {
      taskId,
      startTime: '2024-01-15T11:00:00Z',
    });

    const res = await ipc.invoke('timeEntries:batchMarkReported', [taskId], {
      reportedAt: '2024-01-16T00:00:00Z',
    });
    expect(res.changed).toBe(1);

    const entries = await ipc.invoke('timeEntries:getByTask', taskId);
    const stillRunning = entries.find((e: { id: string }) => e.id === running.id);
    expect(stillRunning.reportedAt).toBeNull();
  });

  it('clearing reported_at is not restricted to completed entries', async () => {
    const done = await ipc.invoke('timeEntries:create', {
      taskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });
    await ipc.invoke('timeEntries:markTaskReported', taskId, '2024-01-16T00:00:00Z');
    // Start a timer after the mark, so an unreported running row coexists.
    await ipc.invoke('timeEntries:create', { taskId, startTime: '2024-01-15T11:00:00Z' });

    const res = await ipc.invoke('timeEntries:markTaskReported', taskId, null);
    expect(res.changed).toBe(1);
    const entries = await ipc.invoke('timeEntries:getByTask', taskId);
    expect(entries.find((e: { id: string }) => e.id === done.id).reportedAt).toBeNull();
  });
});
