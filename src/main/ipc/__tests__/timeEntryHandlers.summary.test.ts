import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { registerCategoryHandlers } from '../categoryHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('TimeEntry Handlers - Summary Report', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;
  let taskIpc: ReturnType<typeof createMockIpcMain>;
  let catIpc: ReturnType<typeof createMockIpcMain>;
  let testTaskId: string;
  let testTaskId2: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    taskIpc = createMockIpcMain();
    catIpc = createMockIpcMain();
    registerTimeEntryHandlers(ipc as never, db);
    registerTaskHandlers(taskIpc as never, db);
    registerCategoryHandlers(catIpc as never, db);

    const task = await taskIpc.invoke('tasks:create', { title: 'Summary Task', source: 'email' });
    testTaskId = task.id;

    const task2 = await taskIpc.invoke('tasks:create', { title: 'Meeting Task', source: 'meeting-prep' });
    testTaskId2 = task2.id;
  });

  afterEach(() => {
    db.close();
  });

  it('getSummaryReport returns entries with source and status', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });

    const report = await ipc.invoke(
      'timeEntries:getSummaryReport',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59Z'
    );

    expect(report).toHaveLength(1);
    expect(report[0].taskTitle).toBe('Summary Task');
    expect(report[0].taskSource).toBe('email');
    expect(report[0].taskStatus).toBe('todo');
    expect(report[0].totalSeconds).toBeGreaterThan(3590);
    expect(report[0].totalSeconds).toBeLessThan(3610);
  });

  it('getSummaryReport includes category IDs', async () => {
    const cat = await catIpc.invoke('categories:create', { name: 'TestCat', color: '#ff0000' });
    await catIpc.invoke('categories:assignToTask', testTaskId, [cat.id]);

    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });

    const report = await ipc.invoke(
      'timeEntries:getSummaryReport',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59Z'
    );

    expect(report[0].categoryIds).toContain(cat.id);
  });

  it('getSummaryReport aggregates per task per day', async () => {
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

    const report = await ipc.invoke(
      'timeEntries:getSummaryReport',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59Z'
    );

    expect(report).toHaveLength(1);
    expect(report[0].totalSeconds).toBeGreaterThan(7190);
  });

  it('getSummaryReport excludes soft-deleted tasks', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });

    await taskIpc.invoke('tasks:delete', testTaskId);

    const report = await ipc.invoke(
      'timeEntries:getSummaryReport',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59Z'
    );

    expect(report).toHaveLength(0);
  });

  it('getByDateRangeWithTasks returns entries with task info', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });

    const entries = await ipc.invoke(
      'timeEntries:getByDateRangeWithTasks',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59Z'
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].taskTitle).toBe('Summary Task');
    expect(entries[0].taskSource).toBe('email');
    expect(entries[0].taskId).toBe(testTaskId);
  });

  it('getByDateRangeWithTasks returns entries sorted by start_time ASC', async () => {
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId2,
      startTime: '2024-01-15T14:00:00Z',
      endTime: '2024-01-15T15:00:00Z',
    });
    await ipc.invoke('timeEntries:create', {
      taskId: testTaskId,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });

    const entries = await ipc.invoke(
      'timeEntries:getByDateRangeWithTasks',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59Z'
    );

    expect(entries).toHaveLength(2);
    expect(entries[0].taskTitle).toBe('Summary Task');
    expect(entries[1].taskTitle).toBe('Meeting Task');
  });
});
