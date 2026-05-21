import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../../database/database';
import { registerImportHandlers } from '../importHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';
import type { ImportPreviewItem } from '../../../shared/types';

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/test-import.md'],
    }),
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mocked = {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(
      '# 2026-03-04\n* [TK-101] Fix login bug: 09:30 (1h 45m)\n* [12345] ADO work item: 11:00 (30m)\n* Meeting prep: 14:00 (45m)\n'
    ),
  };
  return { ...mocked, default: mocked };
});

describe('Import IPC Handlers', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;
  let taskIpc: ReturnType<typeof createMockIpcMain>;

  beforeEach(() => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    taskIpc = createMockIpcMain();
    registerImportHandlers(ipc as never, db);
    registerTaskHandlers(taskIpc as never, db);
    // The markdownParser tags numeric tickets as plugin_id='ado' and TK-* as
    // 'jira'. Install both so the FK on tasks.plugin_id is satisfied; without
    // the plugins row, the importer transparently downgrades to ad-hoc.
    db.instance
      .prepare(
        `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
         VALUES (?, ?, '1.0.0', 1, '{}', datetime('now'), 'sideloaded')`,
      )
      .run('ado', 'ADO');
    db.instance
      .prepare(
        `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
         VALUES (?, ?, '1.0.0', 1, '{}', datetime('now'), 'sideloaded')`,
      )
      .run('jira', 'Jira');
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when dialog is cancelled', async () => {
    const { dialog } = await import('electron');
    (dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ canceled: true, filePaths: [] });

    const result = await ipc.invoke('import:selectAndParse');
    expect(result).toBeNull();
  });

  it('parses file and returns preview items', async () => {
    const preview = await ipc.invoke('import:selectAndParse');
    expect(preview).not.toBeNull();
    expect(preview.filePath).toBe('/tmp/test-import.md');
    expect(preview.items).toHaveLength(3);
    expect(preview.errors).toHaveLength(0);

    // Check Jira detection
    expect(preview.items[0]).toMatchObject({
      title: '[TK-101] Fix login bug',
      source: 'plugin',
      pluginId: 'jira',
      action: 'create',
      existingTask: null,
    });

    // Check ADO detection
    expect(preview.items[1]).toMatchObject({
      title: '[12345] ADO work item',
      source: 'plugin',
      pluginId: 'ado',
      action: 'create',
    });

    // Check ad-hoc
    expect(preview.items[2]).toMatchObject({
      title: 'Meeting prep',
      source: 'ad-hoc',
      pluginId: null,
      action: 'create',
    });
  });

  it('detects duplicate tasks by externalId', async () => {
    // Create an existing task with externalId TK-101
    await taskIpc.invoke('tasks:create', {
      title: '[TK-101] Old task',
      source: 'plugin',
      externalId: 'TK-101',
      pluginId: 'jira',
    });

    const preview = await ipc.invoke('import:selectAndParse');
    expect(preview.items[0].existingTask).not.toBeNull();
    expect(preview.items[0].existingTask.title).toBe('[TK-101] Old task');
    // Existing task should default to 'update' (add time entry) not 'skip'
    expect(preview.items[0].action).toBe('update');
    // Other items should still be 'create'
    expect(preview.items[1].action).toBe('create');
    expect(preview.items[2].action).toBe('create');
  });

  it('execute creates tasks and time entries', async () => {
    const preview = await ipc.invoke('import:selectAndParse');
    const result = await ipc.invoke('import:execute', preview.items);

    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Verify tasks exist in DB
    const tasks = db.instance.prepare('SELECT * FROM tasks').all();
    expect(tasks).toHaveLength(3);

    // Verify time entries exist
    const entries = db.instance.prepare('SELECT * FROM time_entries').all();
    expect(entries).toHaveLength(3);
  });

  it('execute respects skip action', async () => {
    const preview = await ipc.invoke('import:selectAndParse');

    // Mark first item as skip
    const items: ImportPreviewItem[] = preview.items.map((item: ImportPreviewItem, i: number) => ({
      ...item,
      action: i === 0 ? 'skip' as const : 'create' as const,
    }));

    const result = await ipc.invoke('import:execute', items);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);

    const tasks = db.instance.prepare('SELECT * FROM tasks').all();
    expect(tasks).toHaveLength(2);
  });

  it('execute runs in a transaction', async () => {
    const preview = await ipc.invoke('import:selectAndParse');
    const result = await ipc.invoke('import:execute', preview.items);

    // All items created atomically
    expect(result.created).toBe(3);
    const tasks = db.instance.prepare('SELECT * FROM tasks').all();
    const entries = db.instance.prepare('SELECT * FROM time_entries').all();
    expect(tasks).toHaveLength(3);
    expect(entries).toHaveLength(3);
  });
});
