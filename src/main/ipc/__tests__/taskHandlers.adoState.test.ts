import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import {
  createTask,
  updateTask,
  batchUpdateTasks,
  setExternalTaskState,
  upsertExternalTask,
} from '../taskHandlers';
import { DomainError } from '../../errors';

/**
 * Review tier 3: `batchUpdateTasks` skipped the FSM check and never set
 * state_dirty, and `setExternalTaskState` cleared state_dirty unconditionally.
 */
describe('ADO status changes through the batch path', () => {
  let db: Database;
  let mirrorId: string;

  const stateDirty = (id: string) =>
    (db.instance.prepare('SELECT state_dirty FROM tasks WHERE id = ?').get(id) as { state_dirty: number })
      .state_dirty;

  beforeEach(() => {
    db = new Database(':memory:');
    db.instance
      .prepare("INSERT INTO plugins (id, name, version, manifest, enabled) VALUES ('ado', 'ADO', '1', '{}', 1)")
      .run();
    mirrorId = upsertExternalTask(db, {
      pluginId: 'ado',
      externalId: '123',
      title: 'Mirrored story',
      status: 'todo',
    }).id;
  });

  afterEach(() => db.close());

  it('marks a batch status change dirty so push-state picks it up', () => {
    expect(stateDirty(mirrorId)).toBe(0);
    batchUpdateTasks(db, [mirrorId], { status: 'in-progress' });
    // Before the fix this stayed 0: never pushed, then reverted by the pull.
    expect(stateDirty(mirrorId)).toBe(1);
    const row = db.instance.prepare('SELECT status FROM tasks WHERE id = ?').get(mirrorId) as { status: string };
    expect(row.status).toBe('in-progress');
  });

  it('refuses an illegal transition in a batch, and applies nothing', () => {
    updateTask(db, mirrorId, { status: 'in-progress' });
    const other = createTask(db, { title: 'Local task' }).id;

    // in-progress → todo is not an allowed ADO transition.
    expect(() => batchUpdateTasks(db, [other, mirrorId], { status: 'todo' })).toThrow(DomainError);

    // The batch runs in one transaction, so the local task is untouched too.
    const localRow = db.instance.prepare('SELECT status FROM tasks WHERE id = ?').get(other) as { status: string };
    expect(localRow.status).toBe('todo');
    const mirrorRow = db.instance.prepare('SELECT status FROM tasks WHERE id = ?').get(mirrorId) as { status: string };
    expect(mirrorRow.status).toBe('in-progress');
  });

  it('leaves a plain local task free to move backwards in a batch', () => {
    const local = createTask(db, { title: 'Local', status: 'in-progress' }).id;
    batchUpdateTasks(db, [local], { status: 'todo' });
    const row = db.instance.prepare('SELECT status, state_dirty FROM tasks WHERE id = ?').get(local) as {
      status: string;
      state_dirty: number;
    };
    expect(row.status).toBe('todo');
    expect(row.state_dirty).toBe(0);
  });
});

describe('setExternalTaskState clearing state_dirty', () => {
  let db: Database;
  let mirrorId: string;

  const row = (id: string) =>
    db.instance.prepare('SELECT status, state_dirty, external_state FROM tasks WHERE id = ?').get(id) as {
      status: string;
      state_dirty: number;
      external_state: string | null;
    };

  beforeEach(() => {
    db = new Database(':memory:');
    db.instance
      .prepare("INSERT INTO plugins (id, name, version, manifest, enabled) VALUES ('ado', 'ADO', '1', '{}', 1)")
      .run();
    mirrorId = upsertExternalTask(db, {
      pluginId: 'ado',
      externalId: '123',
      title: 'Mirrored story',
      status: 'todo',
    }).id;
    updateTask(db, mirrorId, { status: 'in-progress' });
  });

  afterEach(() => db.close());

  it('clears the flag when the status still matches what was pushed', () => {
    expect(row(mirrorId).state_dirty).toBe(1);
    const res = setExternalTaskState(db, mirrorId, 'Active', 'in-progress');
    expect(res.stillDirty).toBe(false);
    expect(row(mirrorId).state_dirty).toBe(0);
    expect(row(mirrorId).external_state).toBe('Active');
  });

  it('keeps the flag set when the user changed status during the push', () => {
    // The push read "in-progress" and PATCHed ADO; meanwhile the user marked
    // it done. Clearing here would strand that change: the next pull sees a
    // clean task and reverts ct to Active.
    updateTask(db, mirrorId, { status: 'done' });

    const res = setExternalTaskState(db, mirrorId, 'Active', 'in-progress');
    expect(res.stillDirty).toBe(true);
    expect(row(mirrorId).state_dirty).toBe(1);
    // ADO really is in that state, so it is still recorded.
    expect(row(mirrorId).external_state).toBe('Active');
    expect(row(mirrorId).status).toBe('done');
  });

  it('clears unconditionally when no pushed status is supplied', () => {
    // Back-compat with an already-packaged plugin that does not send it.
    updateTask(db, mirrorId, { status: 'done' });
    const res = setExternalTaskState(db, mirrorId, 'Active');
    expect(res.stillDirty).toBe(false);
    expect(row(mirrorId).state_dirty).toBe(0);
  });

  it('rejects an unknown task instead of silently updating nothing', () => {
    expect(() => setExternalTaskState(db, '00000000-0000-0000-0000-000000000000', 'Active')).toThrow(
      DomainError,
    );
  });
});
