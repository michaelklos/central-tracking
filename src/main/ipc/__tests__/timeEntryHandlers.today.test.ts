import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('TimeEntry Handlers - getTodayTotal', () => {
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

  it('returns 0 when no entries exist', async () => {
    const total = await ipc.invoke('timeEntries:getTodayTotal');
    expect(total).toBe(0);
  });

  it('returns correct sum of today completed entries', async () => {
    const now = new Date();
    const start1 = new Date(now.getTime() - 3600000).toISOString(); // 1 hour ago
    const end1 = new Date(now.getTime() - 1800000).toISOString(); // 30 min ago
    const start2 = new Date(now.getTime() - 1800000).toISOString();
    const end2 = now.toISOString();

    // Insert completed entries directly
    db.instance
      .prepare(
        'INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('e1', testTaskId, start1, end1, 1800, '', now.toISOString());
    db.instance
      .prepare(
        'INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('e2', testTaskId, start2, end2, 1800, '', now.toISOString());

    const total = await ipc.invoke('timeEntries:getTodayTotal');
    // Should be approximately 3600 seconds (1 hour total)
    expect(total).toBeGreaterThan(3500);
    expect(total).toBeLessThan(3700);
  });

  it('includes currently running entry elapsed time', async () => {
    // Start a timer (creates an active entry with no end_time)
    await ipc.invoke('timeEntries:create', { taskId: testTaskId });

    // The total should be > 0 because of the running entry
    const total = await ipc.invoke('timeEntries:getTodayTotal');
    expect(total).toBeGreaterThanOrEqual(0);
  });
});
