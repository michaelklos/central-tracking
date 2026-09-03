import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { createTask } from '../taskHandlers';
import { createComment, getCommentsByTask } from '../commentHandlers';
import { createCategory, assignCategoriesToTask } from '../categoryHandlers';
import {
  createTimeEntry,
  markTaskEntriesReported,
  batchMarkTaskEntriesReported,
  getTimeEntriesByTask,
} from '../timeEntryHandlers';
import { resolveTaskId } from '../taskLookup';
import { DomainError } from '../../errors';

/**
 * Review finding 6: only the task handlers resolved a task reference, so the
 * prefix and name-substring forms the CLI advertises silently matched nothing
 * on the timer, time, comment and category commands — `ct task report 3f2a`
 * updated zero rows and exited 0.
 */
describe('resolveTaskId', () => {
  let db: Database;
  let taskId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    taskId = createTask(db, { title: 'Write the report' }).id;
  });

  afterEach(() => db.close());

  it('passes a full UUID through untouched', () => {
    expect(resolveTaskId(db, taskId)).toBe(taskId);
  });

  it('resolves an id prefix and a name substring', () => {
    expect(resolveTaskId(db, taskId.slice(0, 8))).toBe(taskId);
    expect(resolveTaskId(db, 'report')).toBe(taskId);
  });

  it('throws a NOT_FOUND DomainError carrying a 404, not a plain Error', () => {
    try {
      resolveTaskId(db, 'nothing-matches');
      expect.unreachable('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('NOT_FOUND');
      expect((err as DomainError).httpStatus).toBe(404);
    }
  });

  it('treats LIKE metacharacters in the reference as literals', () => {
    // `%` must not turn into a wildcard that matches the whole table.
    expect(() => resolveTaskId(db, '%')).toThrow(DomainError);
  });
});

describe('handlers that accept a task reference', () => {
  let db: Database;
  let taskId: string;
  let prefix: string;

  beforeEach(() => {
    db = new Database(':memory:');
    taskId = createTask(db, { title: 'Write the report' }).id;
    prefix = taskId.slice(0, 8);
  });

  afterEach(() => db.close());

  it('createComment stores the resolved id, so the comment is visible', () => {
    createComment(db, { taskId: prefix, body: 'via prefix' });
    const comments = getCommentsByTask(db, taskId);
    expect(comments.map((c) => c.body)).toEqual(['via prefix']);
  });

  it('getCommentsByTask accepts a prefix', () => {
    createComment(db, { taskId, body: 'hello' });
    expect(getCommentsByTask(db, prefix)).toHaveLength(1);
  });

  it('assignCategoriesToTask accepts a prefix', () => {
    const cat = createCategory(db, { name: 'Ops', color: '#fff' });
    assignCategoriesToTask(db, prefix, [cat.id]);
    const rows = db.instance
      .prepare('SELECT category_id FROM task_categories WHERE task_id = ?')
      .all(taskId) as { category_id: string }[];
    expect(rows.map((r) => r.category_id)).toEqual([cat.id]);
  });

  it('markTaskEntriesReported by prefix actually marks the entries', () => {
    createTimeEntry(db, {
      taskId,
      startTime: '2026-09-01T10:00:00.000Z',
      endTime: '2026-09-01T11:00:00.000Z',
    });
    // Before finding 6 this reported "Marked 0 entries" and exited 0.
    const { changed } = markTaskEntriesReported(db, prefix, '2026-09-02T00:00:00.000Z');
    expect(changed).toBe(1);
  });

  it('batchMarkTaskEntriesReported resolves every reference it is given', () => {
    createTimeEntry(db, {
      taskId,
      startTime: '2026-09-01T10:00:00.000Z',
      endTime: '2026-09-01T11:00:00.000Z',
    });
    const { changed } = batchMarkTaskEntriesReported(db, [prefix], {
      reportedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(changed).toBe(1);
  });

  it('getTimeEntriesByTask accepts a prefix', () => {
    createTimeEntry(db, {
      taskId,
      startTime: '2026-09-01T10:00:00.000Z',
      endTime: '2026-09-01T11:00:00.000Z',
    });
    expect(getTimeEntriesByTask(db, prefix)).toHaveLength(1);
  });
});
