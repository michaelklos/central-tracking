import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../migrations';

describe('Migration 004 - Soft-delete (recycle bin)', () => {
  it('adds deleted_at column to tasks', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const columns = db.pragma('table_info(tasks)') as { name: string }[];
    const names = columns.map((c) => c.name);
    expect(names).toContain('deleted_at');
    db.close();
  });

  it('deleted_at defaults to NULL', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    db.prepare(
      "INSERT INTO tasks (id, title) VALUES ('test-1', 'Test Task')"
    ).run();

    const row = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get('test-1') as { deleted_at: string | null };
    expect(row.deleted_at).toBeNull();
    db.close();
  });

  it('creates idx_tasks_deleted_at index', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'")
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_tasks_deleted_at');
    db.close();
  });

  it('sets schema_version to 4', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(4);
    db.close();
  });
});
