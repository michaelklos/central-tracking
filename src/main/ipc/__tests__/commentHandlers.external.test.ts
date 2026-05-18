import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import {
  upsertExternalComment,
  getCommentsByTask,
  updateComment,
  createComment,
  getPendingSyncComments,
} from '../commentHandlers';
import { upsertExternalTask, createTask } from '../taskHandlers';

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

  it('getPendingSyncComments returns syncable+unsynced comments joined with task source', () => {
    const pending = createComment(db, { taskId, body: 'queue me', syncable: true });
    // Not syncable: must be excluded.
    createComment(db, { taskId, body: 'private', syncable: false });
    // Already synced: must be excluded.
    const synced = createComment(db, { taskId, body: 'already up', syncable: true });
    updateComment(db, synced.id, { synced: true, externalId: 'ext-1' });

    const result = getPendingSyncComments(db, 'ado');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(pending.id);
    expect(result[0].taskExternalId).toBe('500');
    expect(result[0].taskSource).toBe('ado');
  });

  it('getPendingSyncComments filters by task source (other sources ignored)', () => {
    const otherTask = createTask(db, { title: 'AdHoc', source: 'ad-hoc' });
    createComment(db, { taskId: otherTask.id, body: 'ad-hoc cmt', syncable: true });
    const adoComment = createComment(db, { taskId, body: 'ado cmt', syncable: true });

    const adoResult = getPendingSyncComments(db, 'ado');
    expect(adoResult.map((c) => c.id)).toEqual([adoComment.id]);

    const adHocResult = getPendingSyncComments(db, 'ad-hoc');
    expect(adHocResult).toHaveLength(1);
    expect(adHocResult[0].taskSource).toBe('ad-hoc');
  });
});
