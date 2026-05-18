import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { upsertExternalComment, getCommentsByTask, updateComment } from '../commentHandlers';
import { upsertExternalTask } from '../taskHandlers';

describe('Comment external mirror (ADO plugin support)', () => {
  let db: Database;
  let taskId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    const task = upsertExternalTask(db, {
      source: 'ado',
      externalId: '500',
      title: 'T',
    });
    taskId = task.id;
  });
  afterEach(() => {
    db.close();
  });

  it('upsertExternalComment inserts a mirrored comment', () => {
    const c = upsertExternalComment(db, {
      taskId,
      externalId: 'cmt-1',
      body: 'Hi from ADO',
    });
    expect(c.taskId).toBe(taskId);
    expect(c.body).toBe('Hi from ADO');
    expect(c.externalId).toBe('cmt-1');
    expect(c.syncable).toBe(false);
    expect(c.synced).toBe(true);
  });

  it('upsertExternalComment is idempotent on externalId and updates body', () => {
    const a = upsertExternalComment(db, { taskId, externalId: 'cmt-2', body: 'first' });
    const b = upsertExternalComment(db, { taskId, externalId: 'cmt-2', body: 'edited' });
    expect(b.id).toBe(a.id);
    expect(b.body).toBe('edited');
    const list = getCommentsByTask(db, taskId);
    expect(list).toHaveLength(1);
  });

  it('updateComment accepts an externalId field', () => {
    const c = upsertExternalComment(db, { taskId, externalId: 'cmt-3', body: 'b' });
    const updated = updateComment(db, c.id, { externalId: 'cmt-3-renamed' });
    expect(updated.externalId).toBe('cmt-3-renamed');
  });
});
