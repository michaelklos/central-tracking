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
});
