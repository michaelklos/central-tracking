import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('TimeEntry IPC Handlers', () => {
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

  it('creates a time entry that starts a timer (no endTime)', async () => {
    const entry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    expect(entry.id).toBeDefined();
    expect(entry.taskId).toBe(testTaskId);
    expect(entry.startTime).toBeDefined();
    expect(entry.endTime).toBeNull();
    expect(entry.durationSeconds).toBeNull();
  });

  it('getByTask returns entries for the task', async () => {
    await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    const entries = await ipc.invoke('timeEntries:getByTask', testTaskId);
    expect(entries).toHaveLength(1);
    expect(entries[0].taskId).toBe(testTaskId);
  });

  it('getActive returns the running entry', async () => {
    const entry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    const active = await ipc.invoke('timeEntries:getActive');
    expect(active).not.toBeNull();
    expect(active.id).toBe(entry.id);
  });

  it('stopActive stops the running entry', async () => {
    await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    const stopped = await ipc.invoke('timeEntries:stopActive');
    expect(stopped).not.toBeNull();
    expect(stopped.endTime).not.toBeNull();
    expect(stopped.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('stopActive returns null when no active entry', async () => {
    const result = await ipc.invoke('timeEntries:stopActive');
    expect(result).toBeNull();
  });

  it('creating new entry stops active entry (singleton)', async () => {
    const first = await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    const second = await ipc.invoke('timeEntries:create', { taskId: testTaskId });

    const active = await ipc.invoke('timeEntries:getActive');
    expect(active.id).toBe(second.id);

    // First entry should now be stopped
    const entries = await ipc.invoke('timeEntries:getByTask', testTaskId);
    const firstEntry = entries.find((e: { id: string }) => e.id === first.id);
    expect(firstEntry.endTime).not.toBeNull();
  });

  it('updates an entry', async () => {
    const entry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    const updated = await ipc.invoke('timeEntries:update', entry.id, { note: 'Test note' });
    expect(updated.note).toBe('Test note');
  });

  it('deletes an entry', async () => {
    const entry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    await ipc.invoke('timeEntries:delete', entry.id);
    const entries = await ipc.invoke('timeEntries:getByTask', testTaskId);
    expect(entries).toHaveLength(0);
  });
});
