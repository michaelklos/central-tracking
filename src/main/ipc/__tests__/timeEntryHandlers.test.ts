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

  it('updates the start time of a running entry without ending it', async () => {
    // Running entry: created with no endTime; duration_seconds is null.
    const entry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    expect(entry.endTime).toBeNull();
    expect(entry.durationSeconds).toBeNull();

    // User nudges the start time back by 15 minutes via the editor; the editor
    // passes endTime: null through so it remains running.
    const newStart = new Date(Date.now() - 15 * 60_000).toISOString();
    const updated = await ipc.invoke('timeEntries:update', entry.id, {
      startTime: newStart,
      endTime: null,
      note: 'reanchored',
    });

    expect(updated.startTime).toBe(newStart);
    expect(updated.endTime).toBeNull();
    expect(updated.durationSeconds).toBeNull();
    expect(updated.note).toBe('reanchored');

    // Still appears as the active entry afterwards.
    const active = await ipc.invoke('timeEntries:getActive');
    expect(active).not.toBeNull();
    expect(active.id).toBe(entry.id);
    expect(active.startTime).toBe(newStart);
  });

  it('deletes an entry', async () => {
    const entry = await ipc.invoke('timeEntries:create', { taskId: testTaskId });
    await ipc.invoke('timeEntries:delete', entry.id);
    const entries = await ipc.invoke('timeEntries:getByTask', testTaskId);
    expect(entries).toHaveLength(0);
  });

  // ─── Paginated time entry handler ─────────────────────────────────────

  describe('timeEntries:getByTaskPaginated', () => {
    it('returns paginated time entries for a task', async () => {
      // Create 5 manual entries (so singleton timer doesn't stop previous ones)
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        const start = new Date(now.getTime() - (i + 1) * 3600000).toISOString();
        const end = new Date(now.getTime() - i * 3600000).toISOString();
        await ipc.invoke('timeEntries:create', {
          taskId: testTaskId,
          startTime: start,
          endTime: end,
        });
      }

      const page1 = await ipc.invoke('timeEntries:getByTaskPaginated', testTaskId, {
        offset: 0,
        limit: 2,
      });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);
      expect(page1.offset).toBe(0);
      expect(page1.limit).toBe(2);
    });

    it('returns remaining entries on later pages', async () => {
      const now = new Date();
      for (let i = 0; i < 3; i++) {
        const start = new Date(now.getTime() - (i + 1) * 3600000).toISOString();
        const end = new Date(now.getTime() - i * 3600000).toISOString();
        await ipc.invoke('timeEntries:create', {
          taskId: testTaskId,
          startTime: start,
          endTime: end,
        });
      }

      const page2 = await ipc.invoke('timeEntries:getByTaskPaginated', testTaskId, {
        offset: 2,
        limit: 2,
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it('defaults to limit 20 offset 0', async () => {
      const result = await ipc.invoke('timeEntries:getByTaskPaginated', testTaskId);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(0);
    });
  });
});
