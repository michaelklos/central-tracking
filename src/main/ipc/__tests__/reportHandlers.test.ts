import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../../database/database';
import { registerReportHandlers } from '../reportHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { registerTimeEntryHandlers } from '../timeEntryHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';
import * as fs from 'fs';

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/test-report.csv' }),
  },
}));

describe('Report IPC Handlers', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;
  let taskIpc: ReturnType<typeof createMockIpcMain>;
  let timeIpc: ReturnType<typeof createMockIpcMain>;

  beforeEach(async () => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    taskIpc = createMockIpcMain();
    timeIpc = createMockIpcMain();
    registerReportHandlers(ipc as never, db);
    registerTaskHandlers(taskIpc as never, db);
    registerTimeEntryHandlers(timeIpc as never, db);
  });

  afterEach(() => {
    db.close();
  });

  it('exportCsv generates a CSV file with correct columns', async () => {
    const task = await taskIpc.invoke('tasks:create', { title: 'CSV Task' });
    await timeIpc.invoke('timeEntries:create', {
      taskId: task.id,
      startTime: '2024-01-15T09:00:00Z',
      endTime: '2024-01-15T10:00:00Z',
    });

    const result = await ipc.invoke('reports:exportCsv', '2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z');
    expect(result).toBe('/tmp/test-report.csv');

    // Verify file was written with correct content
    const content = fs.readFileSync('/tmp/test-report.csv', 'utf-8');
    expect(content).toContain('Date,Task,Start,End,Duration,Note');
    expect(content).toContain('CSV Task');
  });

  it('returns null when dialog is cancelled', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ canceled: true, filePath: undefined });

    const result = await ipc.invoke('reports:exportCsv', '2024-01-01T00:00:00Z', '2024-01-31T23:59:59Z');
    expect(result).toBeNull();
  });
});
