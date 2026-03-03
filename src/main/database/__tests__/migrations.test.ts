import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../migrations';

describe('Database Migrations', () => {
  it('runs cleanly on an empty database', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });

  it('creates expected tables', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('tasks');
    expect(tableNames).toContain('time_entries');
    expect(tableNames).toContain('comments');
    expect(tableNames).toContain('categories');
    expect(tableNames).toContain('task_categories');
    expect(tableNames).toContain('plugin_config');
    expect(tableNames).toContain('schema_version');
    db.close();
  });

  it('is idempotent (running twice does not throw)', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });

  it('sets schema version to 1 after initial migration', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as {
      version: number;
    };
    expect(row.version).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
