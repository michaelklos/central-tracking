import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

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
});
