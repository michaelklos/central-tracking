import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('TimeEntry Handlers - Report', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;
  let taskIpc: ReturnType<typeof createMockIpcMain>;
  let testTaskId: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    taskIpc = createMockIpcMain();
    registerTimeEntryHandlers(ipc as never, db);
    registerTaskHandlers(taskIpc as never, db);

    const task = await taskIpc.invoke('tasks:create', { title: 'Report Task' });
    testTaskId = task.id;
  });

  afterEach(() => {
    db.close();
  });

  it('getByDateRange returns entries within range', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-02-15T09:00:00Z',
      endTime: '2024-02-15T10:00:00Z',
    });

    const results = await ipc.invoke('timeEntries:getByDateRange', '2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z');
    expect(results).toHaveLength(1);
    expect(new Date(results[0].startTime).getMonth()).toBe(0); // January
  });

  it('getByDateRange excludes entries outside range', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-03-01T09:00:00Z',
      endTime: '2024-03-01T10:00:00Z',
    });

    const results = await ipc.invoke('timeEntries:getByDateRange', '2024-01-01T00:00:00Z', '2024-02-28T23:59:59Z');
    expect(results).toHaveLength(0);
  });

  it('getReport aggregates time per task per day', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-15T14:00:00Z',
      endTime: '2024-01-15T15:00:00Z',
    });

    const report = await ipc.invoke('timeEntries:getReport', '2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z');
    expect(report).toHaveLength(1); // 1 row = 1 day + 1 task
    // julianday arithmetic has minor rounding, so allow ±5s tolerance
    expect(report[0].totalSeconds).toBeGreaterThan(7190);
    expect(report[0].totalSeconds).toBeLessThan(7210);
    expect(report[0].taskTitle).toBe('Report Task');
  });
});
