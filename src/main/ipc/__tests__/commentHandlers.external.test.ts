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

function installPlugin(db: Database, id: string): void {
  db.instance
    .prepare(
      `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
       VALUES (?, ?, '1.0.0', 1, '{}', datetime('now'), 'sideloaded')`,
    )
    .run(id, id);
}

describe('Comment external mirror (plugin support)', () => {
  let db: Database;
  let taskId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    installPlugin(db, 'ado');
    const task = upsertExternalTask(db, {
      pluginId: 'ado',
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
    createComment(db, { taskId, body: 'private', syncable: false });
    const synced = createComment(db, { taskId, body: 'already up', syncable: true });
    updateComment(db, synced.id, { synced: true, externalId: 'ext-1' });

    const result = getPendingSyncComments(db, 'ado');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(pending.id);
    expect(result[0].taskExternalId).toBe('500');
    expect(result[0].taskSource).toBe('plugin');
  });

  it('getPendingSyncComments filters by owning plugin (other plugins ignored)', () => {
    installPlugin(db, 'jira');
    const jiraTask = upsertExternalTask(db, { pluginId: 'jira', externalId: '900', title: 'J' });
    createComment(db, { taskId: jiraTask.id, body: 'jira cmt', syncable: true });
    const adoComment = createComment(db, { taskId, body: 'ado cmt', syncable: true });

    const adoResult = getPendingSyncComments(db, 'ado');
    expect(adoResult.map((c) => c.id)).toEqual([adoComment.id]);

    const jiraResult = getPendingSyncComments(db, 'jira');
    expect(jiraResult).toHaveLength(1);
  });

  it('getPendingSyncComments ignores local ad-hoc tasks', () => {
    const local = createTask(db, { title: 'Local', source: 'ad-hoc' });
    createComment(db, { taskId: local.id, body: 'ad-hoc cmt', syncable: true });
    const adoResult = getPendingSyncComments(db, 'ado');
    expect(adoResult).toHaveLength(0);
  });
});
