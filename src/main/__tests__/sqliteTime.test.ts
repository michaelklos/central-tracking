import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../database/database';
import { createTask, updateTask, deleteTask, getDeletedTasks } from '../ipc/taskHandlers';
import { sqliteTimeToIso } from '../sqliteTime';

/**
 * Review tier 3: `deleted_at` (and every other column written with
 * `datetime('now')`) is stored as `YYYY-MM-DD HH:MM:SS` — UTC, but with a
 * space and no zone suffix, which V8 parses as local. West of UTC the recycle
 * bin computed a negative age and rendered "deleted -1 days ago".
 *
 * The suite pins TZ=America/New_York, so these would pass vacuously under UTC.
 */
describe('sqliteTimeToIso', () => {
  it('reads a SQLite datetime as the UTC instant it actually is', () => {
    expect(sqliteTimeToIso('2026-09-03 21:30:00')).toBe('2026-09-03T21:30:00.000Z');
  });

  it('leaves an already-ISO value alone', () => {
    expect(sqliteTimeToIso('2026-09-03T21:30:00.000Z')).toBe('2026-09-03T21:30:00.000Z');
  });

  it('passes null through', () => {
    expect(sqliteTimeToIso(null)).toBeNull();
  });

  it('leaves an unrecognized shape alone rather than mangling it', () => {
    expect(sqliteTimeToIso('not a timestamp')).toBe('not a timestamp');
  });
});

describe('timestamps reaching the renderer', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => db.close());

  it('reports a just-deleted task as deleted zero days ago, not -1', () => {
    const id = createTask(db, { title: 'Doomed' }).id;
    deleteTask(db, id);

    const deleted = getDeletedTasks(db).items.find((t) => t.id === id);
    expect(deleted).toBeDefined();
    expect(deleted!.deletedAt).not.toBeNull();

    // This is what TaskList.getDaysAgo computes.
    const diffMs = Date.now() - new Date(deleted!.deletedAt as string).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    expect(days).toBe(0);
    // Before the fix diffMs was around -4h here and days came out -1.
    expect(diffMs).toBeGreaterThanOrEqual(0);
  });

  it('normalizes updated_at, which the update path writes in SQLite format', () => {
    // The table genuinely holds both shapes: createTask INSERTs an ISO string,
    // while updateTask writes `updated_at = datetime('now')`. This is the half
    // that was skewed.
    const task = createTask(db, { title: 'Edited' });
    const updated = updateTask(db, task.id, { title: 'Edited twice' });

    const raw = (
      db.instance.prepare('SELECT updated_at FROM tasks WHERE id = ?').get(task.id) as {
        updated_at: string;
      }
    ).updated_at;
    expect(raw).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const skewMs = Math.abs(Date.now() - new Date(updated.updatedAt).getTime());
    expect(skewMs).toBeLessThan(60_000);
  });

  it('gives created/updated timestamps that parse to about now', () => {
    const task = createTask(db, { title: 'Fresh' });
    for (const value of [task.createdAt, task.updatedAt]) {
      const skewMs = Math.abs(Date.now() - new Date(value).getTime());
      // Generous bound: the point is that it is not hours out.
      expect(skewMs).toBeLessThan(60_000);
    }
  });
});
