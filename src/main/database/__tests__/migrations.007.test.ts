import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../migrations';

// Migration 007 added external mirror columns and the (source, external_id)
// unique index. Migration 009 replaced that index with idx_tasks_plugin_external
// and dropped 'ado' from the source enum, so the tests below assert only the
// columns/indexes that survive past 009.
describe('Migration 007 - ADO plugin support (columns retained after 009)', () => {
  it('adds external mirror columns to tasks', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const columns = db.pragma('table_info(tasks)') as { name: string }[];
    const names = columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'external_url',
        'external_state',
        'external_completed_hours',
        'external_refreshed_at',
        'state_dirty',
      ]),
    );
    db.close();
  });

  it('adds external_id column to comments', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const columns = db.pragma('table_info(comments)') as { name: string }[];
    const names = columns.map((c) => c.name);
    expect(names).toContain('external_id');
    db.close();
  });

  it('new task columns default appropriately', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    db.prepare("INSERT INTO tasks (id, title) VALUES ('t1', 'T1')").run();
    const row = db.prepare(
      'SELECT external_url, external_state, external_completed_hours, external_refreshed_at, state_dirty FROM tasks WHERE id = ?',
    ).get('t1') as {
      external_url: string | null;
      external_state: string | null;
      external_completed_hours: number | null;
      external_refreshed_at: string | null;
      state_dirty: number;
    };
    expect(row.external_url).toBeNull();
    expect(row.external_state).toBeNull();
    expect(row.external_completed_hours).toBeNull();
    expect(row.external_refreshed_at).toBeNull();
    expect(row.state_dirty).toBe(0);
    db.close();
  });

  it('creates index on comments.external_id', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'comments'")
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('idx_comments_external_id');
    db.close();
  });

  it('records schema_version 7', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[];
    expect(rows.map((r) => r.version)).toContain(7);
    db.close();
  });
});
