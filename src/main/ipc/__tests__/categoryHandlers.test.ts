import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerCategoryHandlers } from '../categoryHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('Category IPC Handlers', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;

  beforeEach(() => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    registerCategoryHandlers(ipc as never, db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a category with default color', async () => {
    const cat = await ipc.invoke('categories:create', { name: 'Bug' });
    expect(cat.id).toBeDefined();
    expect(cat.name).toBe('Bug');
    expect(cat.color).toBe('#6b7280');
  });

  it('creates a category with custom color', async () => {
    const cat = await ipc.invoke('categories:create', { name: 'Feature', color: '#ff0000' });
    expect(cat.color).toBe('#ff0000');
  });

  it('getAll returns categories sorted by name', async () => {
    await ipc.invoke('categories:create', { name: 'Zebra' });
    await ipc.invoke('categories:create', { name: 'Alpha' });
    await ipc.invoke('categories:create', { name: 'Middle' });

    const cats = await ipc.invoke('categories:getAll');
    expect(cats).toHaveLength(3);
    expect(cats[0].name).toBe('Alpha');
    expect(cats[1].name).toBe('Middle');
    expect(cats[2].name).toBe('Zebra');
  });

  it('updates a category', async () => {
    const cat = await ipc.invoke('categories:create', { name: 'Old Name' });
    const updated = await ipc.invoke('categories:update', cat.id, { name: 'New Name', color: '#00ff00' });
    expect(updated.name).toBe('New Name');
    expect(updated.color).toBe('#00ff00');
  });

  it('deletes a category', async () => {
    const cat = await ipc.invoke('categories:create', { name: 'To Delete' });
    await ipc.invoke('categories:delete', cat.id);
    const cats = await ipc.invoke('categories:getAll');
    expect(cats).toHaveLength(0);
  });

  it('assigns categories to a task', async () => {
    const taskIpc = createMockIpcMain();
    registerTaskHandlers(taskIpc as never, db);

    const task = await taskIpc.invoke('tasks:create', { title: 'Test Task' });
    const cat1 = await ipc.invoke('categories:create', { name: 'Cat1' });
    const cat2 = await ipc.invoke('categories:create', { name: 'Cat2' });

    await ipc.invoke('categories:assignToTask', task.id, [cat1.id, cat2.id]);

    const updatedTask = await taskIpc.invoke('tasks:getById', task.id);
    expect(updatedTask.categoryIds).toContain(cat1.id);
    expect(updatedTask.categoryIds).toContain(cat2.id);
  });

  it('delete category removes task_categories associations', async () => {
    const taskIpc = createMockIpcMain();
    registerTaskHandlers(taskIpc as never, db);

    const task = await taskIpc.invoke('tasks:create', { title: 'Test' });
    const cat = await ipc.invoke('categories:create', { name: 'WillDelete' });
    await ipc.invoke('categories:assignToTask', task.id, [cat.id]);
    await ipc.invoke('categories:delete', cat.id);

    const updatedTask = await taskIpc.invoke('tasks:getById', task.id);
    expect(updatedTask.categoryIds).toHaveLength(0);
  });
});
