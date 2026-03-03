import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { registerCommentHandlers } from '../commentHandlers';
import { registerTaskHandlers } from '../taskHandlers';
import { createMockIpcMain } from '../../../test/mocks/electron';

describe('Comment IPC Handlers', () => {
  let db: Database;
  let ipc: ReturnType<typeof createMockIpcMain>;
  let testTaskId: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    ipc = createMockIpcMain();
    const taskIpc = createMockIpcMain();
    registerCommentHandlers(ipc as never, db);
    registerTaskHandlers(taskIpc as never, db);

    const task = await taskIpc.invoke('tasks:create', { title: 'Test Task' });
    testTaskId = task.id;
  });

  afterEach(() => {
    db.close();
  });

  it('creates a comment', async () => {
    const comment = await ipc.invoke('comments:create', {
      taskId: testTaskId,
      body: 'Test comment',
      syncable: true,
    });
    expect(comment.id).toBeDefined();
    expect(comment.body).toBe('Test comment');
    expect(comment.syncable).toBe(true);
    expect(comment.synced).toBe(false);
  });

  it('getByTask returns comments for the task', async () => {
    await ipc.invoke('comments:create', { taskId: testTaskId, body: 'Comment 1' });
    await ipc.invoke('comments:create', { taskId: testTaskId, body: 'Comment 2' });

    const comments = await ipc.invoke('comments:getByTask', testTaskId);
    expect(comments).toHaveLength(2);
  });

  it('updates a comment', async () => {
    const comment = await ipc.invoke('comments:create', {
      taskId: testTaskId,
      body: 'Original',
    });
    const updated = await ipc.invoke('comments:update', comment.id, {
      body: 'Updated',
      synced: true,
    });
    expect(updated.body).toBe('Updated');
    expect(updated.synced).toBe(true);
  });

  it('deletes a comment', async () => {
    const comment = await ipc.invoke('comments:create', {
      taskId: testTaskId,
      body: 'To delete',
    });
    await ipc.invoke('comments:delete', comment.id);
    const comments = await ipc.invoke('comments:getByTask', testTaskId);
    expect(comments).toHaveLength(0);
  });

  it('creates non-syncable comment by default', async () => {
    const comment = await ipc.invoke('comments:create', {
      taskId: testTaskId,
      body: 'Local comment',
    });
    expect(comment.syncable).toBe(false);
  });
});
