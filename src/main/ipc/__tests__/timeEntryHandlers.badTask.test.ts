import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { createTimeEntry, getActiveTimeEntry } from '../timeEntryHandlers';
import { createTask } from '../taskHandlers';
import { DomainError } from '../../errors';

/**
 * Regression: a `timer start` against a task id that does not exist used to
 * stop the currently running timer first and only then fail on the foreign
 * key, leaving the user with no timer at all.
 */
describe('createTimeEntry with an invalid task id', () => {
  let db: Database;
  let taskId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    taskId = createTask(db, { title: 'Real task' }).id;
  });

  afterEach(() => {
    db.close();
  });

  it('rejects an unknown task id with a typed NOT_FOUND error', () => {
    expect(() => createTimeEntry(db, { taskId: 'does-not-exist' })).toThrow(DomainError);
    try {
      createTimeEntry(db, { taskId: 'does-not-exist' });
    } catch (err) {
      expect((err as DomainError).code).toBe('NOT_FOUND');
      expect((err as DomainError).httpStatus).toBe(404);
    }
  });

  it('leaves the running timer running when the new task id is bad', () => {
    const running = createTimeEntry(db, { taskId });
    expect(getActiveTimeEntry(db)?.id).toBe(running.id);

    expect(() => createTimeEntry(db, { taskId: 'nope' })).toThrow();

    const stillActive = getActiveTimeEntry(db);
    expect(stillActive).not.toBeNull();
    expect(stillActive!.id).toBe(running.id);
    expect(stillActive!.endTime).toBeNull();
  });

  // Review finding 6: the CLI advertises "UUID, prefix, or name substring"
  // for `timer start`, so these handlers resolve the reference the same way
  // the task handlers do.
  it('resolves an id prefix and stores the full id', () => {
    const entry = createTimeEntry(db, { taskId: taskId.slice(0, 8) });
    expect(entry.taskId).toBe(taskId);
  });

  it('resolves a task by name substring', () => {
    const entry = createTimeEntry(db, { taskId: 'real' });
    expect(entry.taskId).toBe(taskId);
  });

  it('rejects an ambiguous prefix rather than picking one', () => {
    // Two titles sharing a substring — the lookup must refuse to guess.
    createTask(db, { title: 'Shared name one' });
    createTask(db, { title: 'Shared name two' });
    try {
      createTimeEntry(db, { taskId: 'Shared name' });
      expect.unreachable('expected an ambiguity error');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('AMBIGUOUS_ID');
    }
  });

  it('still stops the previous timer on a valid start', () => {
    const first = createTimeEntry(db, { taskId });
    const secondTaskId = createTask(db, { title: 'Second' }).id;
    const second = createTimeEntry(db, { taskId: secondTaskId });

    expect(getActiveTimeEntry(db)?.id).toBe(second.id);
    const entries = db.instance
      .prepare('SELECT end_time FROM time_entries WHERE id = ?')
      .get(first.id) as { end_time: string | null };
    expect(entries.end_time).not.toBeNull();
  });
});
