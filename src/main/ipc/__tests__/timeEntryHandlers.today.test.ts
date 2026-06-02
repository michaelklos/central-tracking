import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

/**
 * Return an ISO UTC string for today at the given hour (local time), which is
 * safe to store as a start_time and still satisfy SQLite's
 *   date(start_time, 'localtime') = date('now', 'localtime')
 * filter regardless of the host's UTC offset.
 */
function todayLocalIso(hourLocal: number = 12, minuteLocal: number = 0): string {
  const now = new Date();
  // Build a Date at the requested local clock time today (numeric components
  // avoid any locale/ICU dependence from date string formatting)
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hourLocal, minuteLocal, 0);
  return local.toISOString();
}

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
    // Use noon local time as anchor so the entries always land on today
    // regardless of the host's UTC offset.
    const start1 = todayLocalIso(10, 0);  // 10:00 local
    const end1   = todayLocalIso(10, 30); // 10:30 local
    const start2 = todayLocalIso(11, 0);  // 11:00 local
    const end2   = todayLocalIso(12, 0);  // 12:00 local

    db.instance
      .prepare(
        'INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('e1', testTaskId, start1, end1, 1800, '', start1);
    db.instance
      .prepare(
        'INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('e2', testTaskId, start2, end2, 3600, '', start2);

    const total = await ipc.invoke('timeEntries:getTodayTotal');
    // 30 min + 60 min = 90 min = 5400 seconds
    expect(total).toBeGreaterThan(5300);
    expect(total).toBeLessThan(5500);
  });

  it('running entry (end_time IS NULL) contributes 0 to getTodayTotal', async () => {
    // Start a timer (creates an active entry with no end_time)
    await ipc.invoke('timeEntries:create', { taskId: testTaskId });

    // The running entry must NOT be counted — backend total stays 0;
    // the renderer is the single source of the live elapsed portion.
    const total = await ipc.invoke('timeEntries:getTodayTotal');
    expect(total).toBe(0);
  });

  it('running entry does not double-count when a completed entry also exists', async () => {
    // One completed 30-minute entry anchored at noon local time
    const start = todayLocalIso(10, 0);
    const end   = todayLocalIso(10, 30);
    db.instance
      .prepare(
        'INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('completed', testTaskId, start, end, 1800, '', start);

    // One running entry (no end_time)
    await ipc.invoke('timeEntries:create', { taskId: testTaskId });

    const total = await ipc.invoke('timeEntries:getTodayTotal');
    // Only the completed 30-minute entry counts; the running entry contributes 0
    expect(total).toBeGreaterThan(1700);
    expect(total).toBeLessThan(1900);
  });

  // ─── Regression: exact-hour entry must not lose a second to float truncation ───

  it('regression Bug5: completed entry of exactly one hour sums to 3600 in getTodayTotal (not 3599)', async () => {
    // Insert a precisely 1-hour entry using today's local noon as anchor
    const start = todayLocalIso(10, 0);  // 10:00 local
    const end   = todayLocalIso(11, 0);  // 11:00 local (exactly 3600s later)
    db.instance
      .prepare(
        'INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('exact-hour', testTaskId, start, end, 3600, '', start);

    const total = await ipc.invoke('timeEntries:getTodayTotal');
    // julianday float math used to yield 3599.9999… → CAST truncated to 3599.
    // ROUND fixes this.
    expect(total).toBe(3600);
  });
});
