import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { createTask, updateTask } from '../taskHandlers';
import { createCategory, assignCategoriesToTask, deleteCategory } from '../categoryHandlers';

/**
 * Review tier 3: the DELETE ran outside the transaction that wrapped the
 * inserts. `INSERT OR IGNORE` does not cover foreign-key violations, so one
 * unknown category id threw after the DELETE had committed and the task was
 * left with no categories at all. This matters more now that batch mode is
 * meant to apply several categories at once (addendum A6).
 */
describe('replacing a task\'s categories is all-or-nothing', () => {
  let db: Database;
  let taskId: string;
  let work: string;
  let admin: string;

  const assigned = (id: string) =>
    (
      db.instance
        .prepare('SELECT category_id FROM task_categories WHERE task_id = ? ORDER BY category_id')
        .all(id) as { category_id: string }[]
    ).map((r) => r.category_id);

  beforeEach(() => {
    db = new Database(':memory:');
    taskId = createTask(db, { title: 'Task' }).id;
    work = createCategory(db, { name: 'Work', color: '#111' }).id;
    admin = createCategory(db, { name: 'Admin', color: '#222' }).id;
    assignCategoriesToTask(db, taskId, [work, admin]);
  });

  afterEach(() => db.close());

  it('keeps the existing categories when one id in the batch is unknown', () => {
    expect(assigned(taskId).sort()).toEqual([work, admin].sort());

    expect(() => assignCategoriesToTask(db, taskId, [work, 'no-such-category'])).toThrow();

    // Before the fix this was [] — every category wiped off the task.
    expect(assigned(taskId).sort()).toEqual([work, admin].sort());
  });

  it('applies a valid replacement completely', () => {
    assignCategoriesToTask(db, taskId, [admin]);
    expect(assigned(taskId)).toEqual([admin]);
  });

  it('clears the assignments when given an empty list', () => {
    assignCategoriesToTask(db, taskId, []);
    expect(assigned(taskId)).toEqual([]);
  });

  it('protects the same path through updateTask', () => {
    expect(() => updateTask(db, taskId, { categoryIds: [work, 'no-such-category'] })).toThrow();
    expect(assigned(taskId).sort()).toEqual([work, admin].sort());
  });

  it('deleteCategory removes the category and its assignments together', () => {
    deleteCategory(db, work);
    expect(assigned(taskId)).toEqual([admin]);
    const remaining = db.instance.prepare('SELECT id FROM categories').all() as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual([admin]);
  });
});
