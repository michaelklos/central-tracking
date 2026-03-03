import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../migrations';

describe('Migration 002 - Notes column', () => {
  it('adds notes column to tasks table', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const columns = db.prepare("PRAGMA table_info('tasks')").all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('notes');
    db.close();
  });

  it('existing tasks get default empty string for notes', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');

    // Run only migration 001 first (full schema needed for later migrations)
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        source TEXT NOT NULL DEFAULT 'ad-hoc',
        external_id TEXT,
        plugin_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        start_time TEXT NOT NULL DEFAULT (datetime('now')),
        end_time TEXT,
        duration_seconds INTEGER,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO schema_version (version) VALUES (1);
    `);

    // Insert a task before migration 002
    db.prepare("INSERT INTO tasks (id, title) VALUES ('t1', 'Old Task')").run();

    // Now run all migrations (002 should apply)
    runMigrations(db);

    const task = db.prepare('SELECT notes FROM tasks WHERE id = ?').get('t1') as { notes: string };
    expect(task.notes).toBe('');
    db.close();
  });
});
