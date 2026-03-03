import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('TimeEntry Handlers - Manual Entries', () => {
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

    const task = await taskIpc.invoke('tasks:create', { title: 'Test Task' });
    testTaskId = task.id;
  });

  afterEach(() => {
    db.close();
  });

  it('creating entry with endTime inserts completed entry', async () => {
    const entry = await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-01T09:00:00Z',
      endTime: '2024-01-01T10:00:00Z',
    });
    expect(entry.endTime).not.toBeNull();
    expect(entry.durationSeconds).toBe(3600);
  });

  it('creating entry with endTime does NOT stop existing active timer', async () => {
    // Start an active timer
    const activeEntry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });

    // Create a manual completed entry
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-01T09:00:00Z',
      endTime: '2024-01-01T10:00:00Z',
    });

    // The original active entry should still be running
    const active = await ipc.invoke('timeEntries:getActive');
    expect(active).not.toBeNull();
    expect(active.id).toBe(activeEntry.id);
  });

  it('creating entry without endTime still auto-stops active timer', async () => {
    const firstEntry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    const secondEntry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });

    const active = await ipc.invoke('timeEntries:getActive');
    expect(active.id).toBe(secondEntry.id);
    expect(active.id).not.toBe(firstEntry.id);
  });
});
