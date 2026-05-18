import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import {
  upsertExternalTask,
  updateTask,
  setExternalTaskState,
  getTaskById,
} from '../taskHandlers';

describe('Task external mirror (ADO plugin support)', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  it('upsertExternalTask inserts a new ado task with mirror fields', () => {
    const task = upsertExternalTask(db, {
      source: 'ado',
      externalId: '101',
      title: '#101 — Build widget',
      notes: 'Some notes',
      status: 'todo',
      externalUrl: 'https://dev.azure.com/contoso/proj/_workitems/edit/101',
      externalState: 'New',
      externalCompletedHours: 0,
    });
    expect(task.source).toBe('ado');
    expect(task.externalId).toBe('101');
    expect(task.title).toBe('#101 — Build widget');
    expect(task.notes).toBe('Some notes');
    expect(task.externalState).toBe('New');
    expect(task.externalUrl).toContain('/edit/101');
    expect(task.externalCompletedHours).toBe(0);
    expect(task.stateDirty).toBe(false);
    expect(task.externalRefreshedAt).toBeTruthy();
  });

  it('upsertExternalTask is idempotent on (source, externalId)', () => {
    const first = upsertExternalTask(db, {
      source: 'ado',
      externalId: '101',
      title: 'T1',
    });
    const second = upsertExternalTask(db, {
      source: 'ado',
      externalId: '101',
      title: 'T1 renamed',
      externalState: 'Active',
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('T1 renamed');
    expect(second.externalState).toBe('Active');
  });

  it('updateTask flips state_dirty=1 when ado-source status changes', () => {
    const task = upsertExternalTask(db, {
      source: 'ado',
      externalId: '202',
      title: 'T',
      status: 'todo',
    });
    expect(task.stateDirty).toBe(false);
    const updated = updateTask(db, task.id, { status: 'in-progress' });
    expect(updated.stateDirty).toBe(true);
  });

  it('updateTask does NOT flip state_dirty for ad-hoc tasks', () => {
    // Create via raw upsertExternalTask won't work — ad-hoc has no externalId.
    // Use direct insert path equivalent through the normal API surface.
    db.instance
      .prepare("INSERT INTO tasks (id, title, status, source) VALUES ('x', 'X', 'todo', 'ad-hoc')")
      .run();
    const updated = updateTask(db, 'x', { status: 'in-progress' });
    expect(updated.stateDirty).toBe(false);
  });

  it('setExternalTaskState clears state_dirty and stores new external state', () => {
    const task = upsertExternalTask(db, {
      source: 'ado',
      externalId: '303',
      title: 'T',
      status: 'todo',
      externalState: 'New',
    });
    updateTask(db, task.id, { status: 'in-progress' });
    const dirty = getTaskById(db, task.id);
    expect(dirty?.stateDirty).toBe(true);

    setExternalTaskState(db, task.id, 'Active');
    const cleaned = getTaskById(db, task.id);
    expect(cleaned?.stateDirty).toBe(false);
    expect(cleaned?.externalState).toBe('Active');
  });

  it('updateTask rejects illegal ADO transitions with INVALID_ADO_TRANSITION', () => {
    const task = upsertExternalTask(db, {
      source: 'ado',
      externalId: '500',
      title: 'T',
      status: 'in-progress',
    });
    // in-progress → todo is not in the allowed set.
    expect(() => updateTask(db, task.id, { status: 'todo' })).toThrow(
      /Illegal ADO transition: in-progress → todo/,
    );
    try {
      updateTask(db, task.id, { status: 'todo' });
    } catch (err) {
      expect((err as { code: string }).code).toBe('INVALID_ADO_TRANSITION');
    }
    // Ensure state was not mutated.
    const after = getTaskById(db, task.id);
    expect(after?.status).toBe('in-progress');
    expect(after?.stateDirty).toBe(false);
  });

  it('updateTask allows legal ADO transitions including done → in-progress (reopen)', () => {
    const task = upsertExternalTask(db, {
      source: 'ado',
      externalId: '501',
      title: 'T',
      status: 'done',
    });
    const reopened = updateTask(db, task.id, { status: 'in-progress' });
    expect(reopened.status).toBe('in-progress');
    expect(reopened.stateDirty).toBe(true);
  });

  it('updateTask allows transitions to/from blocked (local-only, no ADO push)', () => {
    const task = upsertExternalTask(db, {
      source: 'ado',
      externalId: '502',
      title: 'T',
      status: 'in-progress',
    });
    const blocked = updateTask(db, task.id, { status: 'blocked' });
    expect(blocked.status).toBe('blocked');
    const unblocked = updateTask(db, task.id, { status: 'in-progress' });
    expect(unblocked.status).toBe('in-progress');
  });

  it('updateTask does NOT enforce FSM for non-ADO tasks', () => {
    db.instance
      .prepare("INSERT INTO tasks (id, title, status, source) VALUES ('y', 'Y', 'in-progress', 'ad-hoc')")
      .run();
    // For ad-hoc, in-progress → todo is fine.
    const updated = updateTask(db, 'y', { status: 'todo' });
    expect(updated.status).toBe('todo');
  });

  it('upsertExternalTask preserves pending status when state_dirty=1', () => {
    const task = upsertExternalTask(db, {
      source: 'ado',
      externalId: '404',
      title: 'T',
      status: 'todo',
      externalState: 'New',
    });
    // User flips status in ct (dirty)
    updateTask(db, task.id, { status: 'in-progress' });
    // Plugin pulls again, ADO still says New — status must NOT be clobbered
    const refreshed = upsertExternalTask(db, {
      source: 'ado',
      externalId: '404',
      title: 'T',
      status: 'todo',
      externalState: 'New',
    });
    expect(refreshed.status).toBe('in-progress');
    expect(refreshed.stateDirty).toBe(true);
  });
});
