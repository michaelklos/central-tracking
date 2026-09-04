import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { generateCsvContent } from '../../reports/csvGenerator';
import { createMockIpcMain } from '../../../test/mocks/electron';

/**
 * Time logged against a task that was later soft-deleted should not be counted
 * anywhere a total is shown. getSummaryReport (the UI report and `ct report`)
 * already filtered; today's total, the getReport route and the CSV export did
 * not, so the same range produced different numbers depending on the surface.
 */
describe('soft-deleted tasks are excluded from time totals', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;
  let taskIpc: ReturnType<typeof createMockIpcMain>;
  let keptId: string;
  let deletedId: string;

  const todayIso = (hhmm: string) => {
    const d = new Date();
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  beforeEach(async () => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    taskIpc = createMockIpcMain();
    registerTimeEntryHandlers(ipc as never, db);
    registerTaskHandlers(taskIpc as never, db);

    keptId = (await taskIpc.invoke('tasks:create', { title: 'Kept' })).id;
    deletedId = (await taskIpc.invoke('tasks:create', { title: 'Deleted' })).id;
  });

  afterEach(() => db.close());

  it('getTodayTotal ignores entries on a soft-deleted task', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: keptId,
      startTime: todayIso('09:00'),
      endTime: todayIso('10:00'),
    });
    await ipc.invoke('timeEntries:create', {
      taskId: deletedId,
      startTime: todayIso('11:00'),
      endTime: todayIso('12:00'),
    });

    expect(await ipc.invoke('timeEntries:getTodayTotal')).toBe(7200);
    await taskIpc.invoke('tasks:delete', deletedId);
    expect(await ipc.invoke('timeEntries:getTodayTotal')).toBe(3600);
  });

  it('getReport and the CSV export drop the soft-deleted task', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: keptId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });
    await ipc.invoke('timeEntries:create', {
      taskId: deletedId,
      startTime: '2024-01-15T11:00:00Z',
      endTime: '2024-01-15T12:00:00Z',
    });
    await taskIpc.invoke('tasks:delete', deletedId);

    const start = '2024-01-01T00:00:00Z';
    const end = '2024-01-31T23:59:59.999Z';

    const report = await ipc.invoke('timeEntries:getReport', start, end);
    expect(report.map((r: { taskTitle: string }) => r.taskTitle)).toEqual(['Kept']);

    const csv = generateCsvContent(db, start, end);
    expect(csv).toContain('Kept');
    expect(csv).not.toContain('Deleted');
  });

  it('getByDateRange drops the soft-deleted task', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: keptId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });
    const gone = await ipc.invoke('timeEntries:create', {
      taskId: deletedId,
      startTime: '2024-01-15T11:00:00Z',
      endTime: '2024-01-15T12:00:00Z',
    });
    await taskIpc.invoke('tasks:delete', deletedId);

    const entries = await ipc.invoke(
      'timeEntries:getByDateRange',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59.999Z',
    );
    expect(entries.map((e: { id: string }) => e.id)).not.toContain(gone.id);
    expect(entries).toHaveLength(1);
  });

  it('restoring the task brings its time back', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: deletedId,
      startTime: todayIso('11:00'),
      endTime: todayIso('12:00'),
    });
    await taskIpc.invoke('tasks:delete', deletedId);
    expect(await ipc.invoke('timeEntries:getTodayTotal')).toBe(0);
    await taskIpc.invoke('tasks:restore', deletedId);
    expect(await ipc.invoke('timeEntries:getTodayTotal')).toBe(3600);
  });
});
