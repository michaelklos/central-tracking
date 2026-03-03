import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('Task Handlers - Notes', () => {
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

  it('created tasks have empty notes by default', async () => {
    const task = await ipc.invoke('tasks:create', { title: 'New Task' });
    expect(task.notes).toBe('');
  });

  it('update task with notes persists the value', async () => {
    const task = await ipc.invoke('tasks:create', { title: 'Task' });
    const updated = await ipc.invoke('tasks:update', task.id, { notes: 'Some important notes' });
    expect(updated.notes).toBe('Some important notes');
  });

  it('getById returns notes field', async () => {
    const task = await ipc.invoke('tasks:create', { title: 'Task' });
    await ipc.invoke('tasks:update', task.id, { notes: 'Hello notes' });
    const found = await ipc.invoke('tasks:getById', task.id);
    expect(found.notes).toBe('Hello notes');
  });
});
