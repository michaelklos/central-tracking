import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

/**
 * Return an ISO UTC string for today at the given local hour, safe to use in
 * queries that filter by date(start_time, 'localtime') = date('now', 'localtime').
 */
function todayLocalIso(hourLocal: number, minuteLocal: number = 0): string {
  const now = new Date();
  const local = new Date(
    `${now.toLocaleDateString('en-CA')}T${String(hourLocal).padStart(2, '0')}:${String(minuteLocal).padStart(2, '0')}:00`
  );
  return local.toISOString();
}

describe('Task IPC Handlers', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;

  beforeEach(() => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    registerTaskHandlers(ipc as never, db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a task and returns it with a UUID id', async () => {
    const task = await ipc.invoke('tasks:create', { title: 'Test Task' });
    expect(task.id).toBeDefined();
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.title).toBe('Test Task');
    expect(task.status).toBe('todo');
    expect(task.source).toBe('ad-hoc');
  });

  it('getAll returns tasks sorted by sort_order', async () => {
    await ipc.invoke('tasks:create', { title: 'First' });
    await ipc.invoke('tasks:create', { title: 'Second' });
    await ipc.invoke('tasks:create', { title: 'Third' });

    const tasks = await ipc.invoke('tasks:getAll');
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe('First');
    expect(tasks[1].title).toBe('Second');
    expect(tasks[2].title).toBe('Third');
  });

  it('getById returns the correct task', async () => {
    const created = await ipc.invoke('tasks:create', { title: 'Find Me' });
    const found = await ipc.invoke('tasks:getById', created.id);
    expect(found).not.toBeNull();
    expect(found.title).toBe('Find Me');
  });

  it('getById returns null for non-existent task', async () => {
    const found = await ipc.invoke('tasks:getById', 'non-existent-id');
    expect(found).toBeNull();
  });

  it('updates task fields', async () => {
    const task = await ipc.invoke('tasks:create', { title: 'Original' });
    const updated = await ipc.invoke('tasks:update', task.id, {
      title: 'Updated',
      status: 'in-progress',
      description: 'New description',
    });
    expect(updated.title).toBe('Updated');
    expect(updated.status).toBe('in-progress');
    expect(updated.description).toBe('New description');
  });

  it('deletes a task', async () => {
    const task = await ipc.invoke('tasks:create', { title: 'To Delete' });
    await ipc.invoke('tasks:delete', task.id);
    const found = await ipc.invoke('tasks:getById', task.id);
    expect(found).toBeNull();
  });

  it('reorder persists new sort order', async () => {
    const t1 = await ipc.invoke('tasks:create', { title: 'A' });
    const t2 = await ipc.invoke('tasks:create', { title: 'B' });
    const t3 = await ipc.invoke('tasks:create', { title: 'C' });

    await ipc.invoke('tasks:reorder', [t3.id, t1.id, t2.id]);

    const tasks = await ipc.invoke('tasks:getAll');
    expect(tasks[0].title).toBe('C');
    expect(tasks[1].title).toBe('A');
    expect(tasks[2].title).toBe('B');
  });

  it('creates task with categories', async () => {
    // Create a category first
    const catIpc = createMockIpcMain();
    const { registerCategoryHandlers } = await import('../categoryHandlers');
    registerCategoryHandlers(catIpc as never, db);

    const cat = await catIpc.invoke('categories:create', { name: 'Bug', color: '#ff0000' });

    const task = await ipc.invoke('tasks:create', {
      title: 'Bug Task',
      categoryIds: [cat.id],
    });
    expect(task.categoryIds).toContain(cat.id);
  });

  it('computes totalTimeSeconds and todayTimeSeconds', async () => {
    const task = await ipc.invoke('tasks:create', { title: 'Tracked Task' });
    expect(task.totalTimeSeconds).toBe(0);
    expect(task.todayTimeSeconds).toBe(0);
  });

  // ─── Paginated task handlers ──────────────────────────────────────────

  describe('tasks:getActive', () => {
    it('returns only non-done tasks', async () => {
      await ipc.invoke('tasks:create', { title: 'Active 1' });
      await ipc.invoke('tasks:create', { title: 'Active 2' });
      const done = await ipc.invoke('tasks:create', { title: 'Done Task' });
      await ipc.invoke('tasks:update', done.id, { status: 'done' });

      const result = await ipc.invoke('tasks:getActive');
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.items.every((t: { status: string }) => t.status !== 'done')).toBe(true);
    });

    it('paginates with offset and limit', async () => {
      for (let i = 0; i < 5; i++) {
        await ipc.invoke('tasks:create', { title: `Task ${i}` });
      }

      const page1 = await ipc.invoke('tasks:getActive', { offset: 0, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);
      expect(page1.offset).toBe(0);
      expect(page1.limit).toBe(2);

      const page2 = await ipc.invoke('tasks:getActive', { offset: 2, limit: 2 });
      expect(page2.items).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      const page3 = await ipc.invoke('tasks:getActive', { offset: 4, limit: 2 });
      expect(page3.items).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });

    it('defaults to limit 50 offset 0', async () => {
      await ipc.invoke('tasks:create', { title: 'Task' });
      const result = await ipc.invoke('tasks:getActive');
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(50);
    });
  });

  describe('tasks:getDone', () => {
    it('returns only done tasks', async () => {
      await ipc.invoke('tasks:create', { title: 'Active' });
      const done1 = await ipc.invoke('tasks:create', { title: 'Done 1' });
      await ipc.invoke('tasks:update', done1.id, { status: 'done' });
      const done2 = await ipc.invoke('tasks:create', { title: 'Done 2' });
      await ipc.invoke('tasks:update', done2.id, { status: 'done' });

      const result = await ipc.invoke('tasks:getDone');
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.items.every((t: { status: string }) => t.status === 'done')).toBe(true);
    });

    it('paginates done tasks', async () => {
      for (let i = 0; i < 3; i++) {
        const t = await ipc.invoke('tasks:create', { title: `Done ${i}` });
        await ipc.invoke('tasks:update', t.id, { status: 'done' });
      }

      const page1 = await ipc.invoke('tasks:getDone', { offset: 0, limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await ipc.invoke('tasks:getDone', { offset: 2, limit: 2 });
      expect(page2.items).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it('returns total count even with limit 0', async () => {
      const t = await ipc.invoke('tasks:create', { title: 'Done' });
      await ipc.invoke('tasks:update', t.id, { status: 'done' });

      const result = await ipc.invoke('tasks:getDone', { offset: 0, limit: 0 });
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(1);
    });
  });

  // ─── Soft-delete (recycle bin) ───────────────────────────────────────

  describe('soft-delete', () => {
    it('delete soft-deletes a task (sets deleted_at)', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'To Soft Delete' });
      await ipc.invoke('tasks:delete', task.id);

      // Not visible in getById
      const found = await ipc.invoke('tasks:getById', task.id);
      expect(found).toBeNull();

      // Visible in getDeleted
      const deleted = await ipc.invoke('tasks:getDeleted');
      expect(deleted.items).toHaveLength(1);
      expect(deleted.items[0].title).toBe('To Soft Delete');
      expect(deleted.items[0].deletedAt).not.toBeNull();
    });

    it('soft-deleted tasks are excluded from getAll', async () => {
      await ipc.invoke('tasks:create', { title: 'Visible' });
      const toDelete = await ipc.invoke('tasks:create', { title: 'Hidden' });
      await ipc.invoke('tasks:delete', toDelete.id);

      const all = await ipc.invoke('tasks:getAll');
      expect(all).toHaveLength(1);
      expect(all[0].title).toBe('Visible');
    });

    it('soft-deleted tasks are excluded from getActive', async () => {
      await ipc.invoke('tasks:create', { title: 'Active' });
      const toDelete = await ipc.invoke('tasks:create', { title: 'Deleted' });
      await ipc.invoke('tasks:delete', toDelete.id);

      const result = await ipc.invoke('tasks:getActive');
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('soft-deleted done tasks are excluded from getDone', async () => {
      const done = await ipc.invoke('tasks:create', { title: 'Done Task' });
      await ipc.invoke('tasks:update', done.id, { status: 'done' });
      await ipc.invoke('tasks:delete', done.id);

      const result = await ipc.invoke('tasks:getDone');
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('restore brings a task back', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'Restore Me' });
      await ipc.invoke('tasks:delete', task.id);

      const restored = await ipc.invoke('tasks:restore', task.id);
      expect(restored.title).toBe('Restore Me');
      expect(restored.deletedAt).toBeNull();

      const found = await ipc.invoke('tasks:getById', task.id);
      expect(found).not.toBeNull();
    });

    it('purgeDeleted permanently removes a soft-deleted task', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'Purge Me' });
      await ipc.invoke('tasks:delete', task.id);
      await ipc.invoke('tasks:purgeDeleted', task.id);

      const deleted = await ipc.invoke('tasks:getDeleted');
      expect(deleted.items).toHaveLength(0);
    });

    it('emptyRecycleBin permanently removes all soft-deleted tasks', async () => {
      const t1 = await ipc.invoke('tasks:create', { title: 'Del 1' });
      const t2 = await ipc.invoke('tasks:create', { title: 'Del 2' });
      await ipc.invoke('tasks:create', { title: 'Keep' });

      await ipc.invoke('tasks:delete', t1.id);
      await ipc.invoke('tasks:delete', t2.id);
      await ipc.invoke('tasks:emptyRecycleBin');

      const deleted = await ipc.invoke('tasks:getDeleted');
      expect(deleted.items).toHaveLength(0);

      const all = await ipc.invoke('tasks:getAll');
      expect(all).toHaveLength(1);
      expect(all[0].title).toBe('Keep');
    });
  });

  // ─── Batch operations ───────────────────────────────────────────────

  describe('batch operations', () => {
    it('batchUpdate updates status for multiple tasks', async () => {
      const t1 = await ipc.invoke('tasks:create', { title: 'Batch 1' });
      const t2 = await ipc.invoke('tasks:create', { title: 'Batch 2' });

      const result = await ipc.invoke('tasks:batchUpdate', [t1.id, t2.id], { status: 'in-progress' });
      expect(result.updatedCount).toBe(2);

      const updated1 = await ipc.invoke('tasks:getById', t1.id);
      const updated2 = await ipc.invoke('tasks:getById', t2.id);
      expect(updated1.status).toBe('in-progress');
      expect(updated2.status).toBe('in-progress');
    });

    it('batchUpdate updates source for multiple tasks', async () => {
      const t1 = await ipc.invoke('tasks:create', { title: 'Batch 1' });
      const t2 = await ipc.invoke('tasks:create', { title: 'Batch 2' });

      await ipc.invoke('tasks:batchUpdate', [t1.id, t2.id], { source: 'email' });

      const updated1 = await ipc.invoke('tasks:getById', t1.id);
      const updated2 = await ipc.invoke('tasks:getById', t2.id);
      expect(updated1.source).toBe('email');
      expect(updated2.source).toBe('email');
    });

    it('batchUpdate assigns categories', async () => {
      const catIpc = createMockIpcMain();
      const { registerCategoryHandlers } = await import('../categoryHandlers');
      registerCategoryHandlers(catIpc as never, db);

      const cat = await catIpc.invoke('categories:create', { name: 'Batch Cat' });
      const t1 = await ipc.invoke('tasks:create', { title: 'Cat Task' });

      await ipc.invoke('tasks:batchUpdate', [t1.id], { categoryIds: [cat.id] });

      const updated = await ipc.invoke('tasks:getById', t1.id);
      expect(updated.categoryIds).toContain(cat.id);
    });

    it('batchUpdate preserves existing categories (additive)', async () => {
      const catIpc = createMockIpcMain();
      const { registerCategoryHandlers } = await import('../categoryHandlers');
      registerCategoryHandlers(catIpc as never, db);

      const catA = await catIpc.invoke('categories:create', { name: 'Cat A' });
      const catB = await catIpc.invoke('categories:create', { name: 'Cat B' });
      const t1 = await ipc.invoke('tasks:create', { title: 'Multi Cat', categoryIds: [catA.id] });

      await ipc.invoke('tasks:batchUpdate', [t1.id], { categoryIds: [catB.id] });

      const updated = await ipc.invoke('tasks:getById', t1.id);
      expect(updated.categoryIds).toEqual(expect.arrayContaining([catA.id, catB.id]));
      expect(updated.categoryIds).toHaveLength(2);
    });

    it('batchSoftDelete soft-deletes multiple tasks', async () => {
      const t1 = await ipc.invoke('tasks:create', { title: 'Del 1' });
      const t2 = await ipc.invoke('tasks:create', { title: 'Del 2' });
      await ipc.invoke('tasks:create', { title: 'Keep' });

      const result = await ipc.invoke('tasks:batchSoftDelete', [t1.id, t2.id]);
      expect(result.deletedCount).toBe(2);

      const all = await ipc.invoke('tasks:getAll');
      expect(all).toHaveLength(1);
      expect(all[0].title).toBe('Keep');

      const deleted = await ipc.invoke('tasks:getDeleted');
      expect(deleted.items).toHaveLength(2);
    });

    it('batchRestore restores multiple tasks', async () => {
      const t1 = await ipc.invoke('tasks:create', { title: 'Restore 1' });
      const t2 = await ipc.invoke('tasks:create', { title: 'Restore 2' });
      await ipc.invoke('tasks:batchSoftDelete', [t1.id, t2.id]);

      const result = await ipc.invoke('tasks:batchRestore', [t1.id, t2.id]);
      expect(result.restoredCount).toBe(2);

      const all = await ipc.invoke('tasks:getAll');
      expect(all).toHaveLength(2);

      const deleted = await ipc.invoke('tasks:getDeleted');
      expect(deleted.items).toHaveLength(0);
    });
  });

  // ─── Source in update ──────────────────────────────────────────────

  it('updates task source', async () => {
    const task = await ipc.invoke('tasks:create', { title: 'Source Test' });
    const updated = await ipc.invoke('tasks:update', task.id, { source: 'email' });
    expect(updated.source).toBe('email');
  });

  // ─── Reported-state aggregate + filter ─────────────────────────────

  describe('reported-state aggregate', () => {
    let timeIpc: ReturnType<typeof createMockIpcMain>;
    beforeEach(async () => {
      timeIpc = createMockIpcMain();
      const { registerTimeEntryHandlers } = await import('../timeEntryHandlers');
      registerTimeEntryHandlers(timeIpc as never, db);
    });

    it('rowToTask returns unreportedTimeSeconds equal to sum of unreported entries', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'Recurring meeting' });
      // 30 minutes — reported
      const entryA = await timeIpc.invoke('timeEntries:create', {
        taskId: task.id,
        startTime: '2026-05-12T13:00:00.000Z',
        endTime: '2026-05-12T13:30:00.000Z',
      });
      await timeIpc.invoke('timeEntries:update', entryA.id, {
        reportedAt: '2026-05-12T17:00:00.000Z',
      });
      // 45 minutes — unreported
      await timeIpc.invoke('timeEntries:create', {
        taskId: task.id,
        startTime: '2026-05-13T13:00:00.000Z',
        endTime: '2026-05-13T13:45:00.000Z',
      });

      const refreshed = await ipc.invoke('tasks:getById', task.id);
      expect(refreshed.unreportedTimeSeconds).toBe(45 * 60);
      expect(refreshed.hasUnreportedTime).toBe(true);
      expect(refreshed.totalTimeSeconds).toBe((30 + 45) * 60);
    });

    it('hasUnreportedTime=true filter excludes tasks whose entries are all reported', async () => {
      const fullyReported = await ipc.invoke('tasks:create', { title: 'All Reported' });
      const partial = await ipc.invoke('tasks:create', { title: 'Has Unreported' });

      const e1 = await timeIpc.invoke('timeEntries:create', {
        taskId: fullyReported.id,
        startTime: '2026-05-12T10:00:00.000Z',
        endTime: '2026-05-12T10:30:00.000Z',
      });
      await timeIpc.invoke('timeEntries:update', e1.id, {
        reportedAt: '2026-05-13T09:00:00.000Z',
      });
      await timeIpc.invoke('timeEntries:create', {
        taskId: partial.id,
        startTime: '2026-05-12T11:00:00.000Z',
        endTime: '2026-05-12T11:30:00.000Z',
      });

      const filtered = await ipc.invoke('tasks:getActive', { hasUnreportedTime: true });
      const titles = filtered.items.map((t: { title: string }) => t.title);
      expect(titles).toContain('Has Unreported');
      expect(titles).not.toContain('All Reported');
    });

    it('hasUnreportedTime=true filter excludes tasks with no time entries at all', async () => {
      await ipc.invoke('tasks:create', { title: 'Empty' });
      const filtered = await ipc.invoke('tasks:getActive', { hasUnreportedTime: true });
      expect(filtered.items.find((t: { title: string }) => t.title === 'Empty')).toBeUndefined();
    });
  });

  describe('uncategorized filter', () => {
    it('uncategorized=true returns only tasks with zero categories', async () => {
      const catIpc = createMockIpcMain();
      const { registerCategoryHandlers } = await import('../categoryHandlers');
      registerCategoryHandlers(catIpc as never, db);
      const cat = await catIpc.invoke('categories:create', { name: 'Has Cat' });

      await ipc.invoke('tasks:create', { title: 'Naked' });
      await ipc.invoke('tasks:create', { title: 'Clothed', categoryIds: [cat.id] });

      const filtered = await ipc.invoke('tasks:getActive', { uncategorized: true });
      const titles = filtered.items.map((t: { title: string }) => t.title);
      expect(titles).toContain('Naked');
      expect(titles).not.toContain('Clothed');
    });
  });

  describe('linkTaskToPlugin / unlinkTaskFromPlugin', () => {
    let pluginIpc: ReturnType<typeof createMockIpcMain>;
    beforeEach(async () => {
      pluginIpc = createMockIpcMain();
      const { registerPluginHandlers } = await import('../pluginHandlers');
      registerPluginHandlers(pluginIpc as never, db);
      await pluginIpc.invoke('plugins:list'); // ensure handler registered
      // Seed a plugin so link() can reference it.
      db.instance
        .prepare('INSERT INTO plugins (id, name, version, enabled, manifest, installed_at) VALUES (?, ?, ?, 1, ?, ?)')
        .run('ado', 'Azure DevOps', '0.1.0', JSON.stringify({ id: 'ado', name: 'Azure DevOps', version: '0.1.0' }), new Date().toISOString());
    });

    it('link mode sets plugin_id and external_id, leaves source intact', async () => {
      const t = await ipc.invoke('tasks:create', { title: 'Local thing' });
      const linked = await ipc.invoke('tasks:link', t.id, { pluginId: 'ado', externalId: '12345', mode: 'link' });
      expect(linked.pluginId).toBe('ado');
      expect(linked.externalId).toBe('12345');
      expect(linked.source).toBe('ad-hoc'); // unchanged
    });

    it('mirror mode flips source to the generic "plugin" key for any plugin', async () => {
      const t = await ipc.invoke('tasks:create', { title: 'Mirror target' });
      const linked = await ipc.invoke('tasks:link', t.id, { pluginId: 'ado', externalId: '99', mode: 'mirror' });
      expect(linked.pluginId).toBe('ado');
      expect(linked.source).toBe('plugin');
    });

    it('mirror mode for a non-ado plugin also uses the "plugin" source', async () => {
      db.instance
        .prepare('INSERT INTO plugins (id, name, version, enabled, manifest, installed_at) VALUES (?, ?, ?, 1, ?, ?)')
        .run('jira', 'Jira', '0.0.1', JSON.stringify({ id: 'jira', name: 'Jira', version: '0.0.1' }), new Date().toISOString());
      const t = await ipc.invoke('tasks:create', { title: 'Mirror jira' });
      const linked = await ipc.invoke('tasks:link', t.id, { pluginId: 'jira', externalId: 'PROJ-1', mode: 'mirror' });
      expect(linked.source).toBe('plugin');
    });

    it('rejects link to a disabled plugin', async () => {
      db.instance.prepare('UPDATE plugins SET enabled = 0 WHERE id = ?').run('ado');
      const t = await ipc.invoke('tasks:create', { title: 'No-go' });
      await expect(
        ipc.invoke('tasks:link', t.id, { pluginId: 'ado', externalId: '1', mode: 'link' }),
      ).rejects.toThrow(/disabled/);
    });

    it('rejects empty external ID', async () => {
      const t = await ipc.invoke('tasks:create', { title: 'Bad input' });
      await expect(
        ipc.invoke('tasks:link', t.id, { pluginId: 'ado', externalId: '   ', mode: 'link' }),
      ).rejects.toThrow(/externalId/);
    });

    it('unlink (link-mode origin) clears plugin_id/external_id; source unchanged', async () => {
      const t = await ipc.invoke('tasks:create', { title: 'Link-only' });
      await ipc.invoke('tasks:link', t.id, { pluginId: 'ado', externalId: '7', mode: 'link' });
      const unlinked = await ipc.invoke('tasks:unlink', t.id);
      expect(unlinked.pluginId).toBeNull();
      expect(unlinked.externalId).toBeNull();
      expect(unlinked.source).toBe('ad-hoc');
    });

    it('unlink (mirror-mode origin) resets source to ad-hoc and clears mirrored columns', async () => {
      const t = await ipc.invoke('tasks:create', { title: 'Was mirror' });
      await ipc.invoke('tasks:link', t.id, { pluginId: 'ado', externalId: '88', mode: 'mirror' });
      // Pretend a pull happened and populated external_state/url.
      db.instance
        .prepare("UPDATE tasks SET external_state = 'Active', external_url = 'https://x', external_completed_hours = 2 WHERE id = ?")
        .run(t.id);
      const unlinked = await ipc.invoke('tasks:unlink', t.id);
      expect(unlinked.pluginId).toBeNull();
      expect(unlinked.externalId).toBeNull();
      expect(unlinked.source).toBe('ad-hoc');
      expect(unlinked.externalState).toBeNull();
      expect(unlinked.externalUrl).toBeNull();
      expect(unlinked.externalCompletedHours).toBeNull();
    });
  });

  describe('date-range filter', () => {
    let timeIpc: ReturnType<typeof createMockIpcMain>;
    beforeEach(async () => {
      timeIpc = createMockIpcMain();
      const { registerTimeEntryHandlers } = await import('../timeEntryHandlers');
      registerTimeEntryHandlers(timeIpc as never, db);
    });

    async function seedTaskWithEntry(title: string, isoStart: string, isoEnd: string) {
      const task = await ipc.invoke('tasks:create', { title });
      await timeIpc.invoke('timeEntries:create', {
        taskId: task.id,
        startTime: isoStart,
        endTime: isoEnd,
      });
      return task;
    }

    it('returns only tasks with at least one entry in [dateStart, dateEnd]', async () => {
      await seedTaskWithEntry('In Range', '2026-03-15T10:00:00.000Z', '2026-03-15T11:00:00.000Z');
      await seedTaskWithEntry('Out Of Range', '2026-02-01T10:00:00.000Z', '2026-02-01T11:00:00.000Z');
      await ipc.invoke('tasks:create', { title: 'No Entries' });

      const res = await ipc.invoke('tasks:getActive', { dateStart: '2026-03-01', dateEnd: '2026-03-31' });
      const titles = res.items.map((t: { title: string }) => t.title);
      expect(titles).toContain('In Range');
      expect(titles).not.toContain('Out Of Range');
      expect(titles).not.toContain('No Entries');
    });

    it('boundary dates are inclusive (start of day on dateStart, end of day on dateEnd)', async () => {
      await seedTaskWithEntry('Start Edge', '2026-03-01T00:00:00.000Z', '2026-03-01T00:30:00.000Z');
      await seedTaskWithEntry('End Edge', '2026-03-31T23:30:00.000Z', '2026-03-31T23:59:00.000Z');

      const res = await ipc.invoke('tasks:getActive', { dateStart: '2026-03-01', dateEnd: '2026-03-31' });
      const titles = res.items.map((t: { title: string }) => t.title);
      expect(titles).toContain('Start Edge');
      expect(titles).toContain('End Edge');
    });

    it('only dateStart given acts as lower-bound only', async () => {
      await seedTaskWithEntry('Before', '2026-02-15T10:00:00.000Z', '2026-02-15T11:00:00.000Z');
      await seedTaskWithEntry('Future', '2026-06-15T10:00:00.000Z', '2026-06-15T11:00:00.000Z');

      const res = await ipc.invoke('tasks:getActive', { dateStart: '2026-03-01' });
      const titles = res.items.map((t: { title: string }) => t.title);
      expect(titles).not.toContain('Before');
      expect(titles).toContain('Future');
    });

    it('only dateEnd given acts as upper-bound only', async () => {
      await seedTaskWithEntry('Old', '2025-12-01T10:00:00.000Z', '2025-12-01T11:00:00.000Z');
      await seedTaskWithEntry('After', '2026-04-01T10:00:00.000Z', '2026-04-01T11:00:00.000Z');

      const res = await ipc.invoke('tasks:getActive', { dateEnd: '2026-03-31' });
      const titles = res.items.map((t: { title: string }) => t.title);
      expect(titles).toContain('Old');
      expect(titles).not.toContain('After');
    });

    it('both bounds blank is a no-op (full list returns)', async () => {
      await ipc.invoke('tasks:create', { title: 'A' });
      await ipc.invoke('tasks:create', { title: 'B' });

      const res = await ipc.invoke('tasks:getActive', { dateStart: '', dateEnd: '' });
      const titles = res.items.map((t: { title: string }) => t.title);
      expect(titles).toContain('A');
      expect(titles).toContain('B');
    });

    it('ANDs with status filter', async () => {
      const inRangeTodo = await seedTaskWithEntry('Todo InRange', '2026-03-10T10:00:00.000Z', '2026-03-10T11:00:00.000Z');
      const inRangeDone = await seedTaskWithEntry('Done InRange', '2026-03-12T10:00:00.000Z', '2026-03-12T11:00:00.000Z');
      await ipc.invoke('tasks:update', inRangeDone.id, { status: 'done' });
      // suppress unused variable warning
      void inRangeTodo;

      const active = await ipc.invoke('tasks:getActive', {
        dateStart: '2026-03-01',
        dateEnd: '2026-03-31',
        status: ['todo'],
      });
      const activeTitles = active.items.map((t: { title: string }) => t.title);
      expect(activeTitles).toContain('Todo InRange');
      expect(activeTitles).not.toContain('Done InRange');

      const done = await ipc.invoke('tasks:getDone', {
        dateStart: '2026-03-01',
        dateEnd: '2026-03-31',
      });
      const doneTitles = done.items.map((t: { title: string }) => t.title);
      expect(doneTitles).toContain('Done InRange');
    });
  });

  // ─── Timer-math regression tests (Bug 4 + Bug 5) ───────────────────

  describe('timer-math aggregation', () => {
    let timeIpc: ReturnType<typeof createMockIpcMain>;
    beforeEach(async () => {
      timeIpc = createMockIpcMain();
      const { registerTimeEntryHandlers } = await import('../timeEntryHandlers');
      registerTimeEntryHandlers(timeIpc as never, db);
    });

    it('regression Bug5: completed entry of exactly one hour sums to 3600 in totalTimeSeconds (not 3599)', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'Exact Hour Task' });
      // Insert a precisely 1-hour entry using fixed timestamps
      db.instance
        .prepare(
          'INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at) VALUES (?, ?, ?, ?, 3600, ?, ?)'
        )
        .run(
          'exact-1h',
          task.id,
          '2026-05-01T10:00:00.000Z',
          '2026-05-01T11:00:00.000Z',
          '',
          '2026-05-01T10:00:00.000Z',
        );

      const refreshed = await ipc.invoke('tasks:getById', task.id);
      // julianday float math used to yield 3599.9999… → CAST truncated to 3599.
      // ROUND fixes this: the result must be exactly 3600.
      expect(refreshed.totalTimeSeconds).toBe(3600);
    });

    it('regression Bug5: completed entry of exactly one hour sums to 3600 in todayTimeSeconds (not 3599)', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'Exact Hour Today Task' });
      // Anchor at local noon so the entry is guaranteed to be "today" regardless
      // of the host's UTC offset.
      const start = todayLocalIso(10, 0);
      const end   = todayLocalIso(11, 0);
      db.instance
        .prepare(
          'INSERT INTO time_entries (id, task_id, start_time, end_time, duration_seconds, note, created_at) VALUES (?, ?, ?, ?, 3600, ?, ?)'
        )
        .run('exact-1h-today', task.id, start, end, '', start);

      const refreshed = await ipc.invoke('tasks:getById', task.id);
      expect(refreshed.todayTimeSeconds).toBe(3600);
    });

    it('regression Bug4: running entry (end_time IS NULL) contributes 0 to totalTimeSeconds', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'Running Task' });
      // Start a live timer (no end_time)
      await timeIpc.invoke('timeEntries:create', { taskId: task.id });

      const refreshed = await ipc.invoke('tasks:getById', task.id);
      // Backend must contribute 0; the renderer holds the live elapsed portion.
      expect(refreshed.totalTimeSeconds).toBe(0);
    });

    it('regression Bug4: running entry (end_time IS NULL) contributes 0 to todayTimeSeconds', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'Running Today Task' });
      await timeIpc.invoke('timeEntries:create', { taskId: task.id });

      const refreshed = await ipc.invoke('tasks:getById', task.id);
      expect(refreshed.todayTimeSeconds).toBe(0);
    });

    it('completed entries still accumulate correctly alongside a running entry', async () => {
      const task = await ipc.invoke('tasks:create', { title: 'Mixed Task' });
      // A completed 30-minute entry
      await timeIpc.invoke('timeEntries:create', {
        taskId: task.id,
        startTime: '2026-05-01T10:00:00.000Z',
        endTime: '2026-05-01T10:30:00.000Z',
      });
      // Start a running entry
      await timeIpc.invoke('timeEntries:create', { taskId: task.id });

      const refreshed = await ipc.invoke('tasks:getById', task.id);
      // Only the 30-minute completed entry counts in the backend total
      expect(refreshed.totalTimeSeconds).toBe(30 * 60);
    });
  });
});
