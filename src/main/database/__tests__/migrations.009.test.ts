import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../migrations';

function openDbAt(upTo: number): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, upTo);
  return db;
}

describe('Migration 009 - decouple TaskSource from ADO', () => {
  it('replaces idx_tasks_source_external with idx_tasks_plugin_external', () => {
    const db = openDbAt(9);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'")
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_tasks_plugin_external');
    expect(names).not.toContain('idx_tasks_source_external');
    db.close();
  });

  it('backfills source=ado rows to source=plugin, plugin_id=ado', () => {
    const db = openDbAt(8);
    // Pre-migration: install ado plugin, insert two ADO-style tasks.
    db.prepare(
      `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
       VALUES ('ado', 'ADO', '1.0.0', 1, '{}', datetime('now'), 'bundled')`,
    ).run();
    db.prepare(
      "INSERT INTO tasks (id, title, source, external_id) VALUES ('a', 'A', 'ado', '111')",
    ).run();
    db.prepare(
      "INSERT INTO tasks (id, title, source, external_id) VALUES ('b', 'B', 'ado', '222')",
    ).run();

    // Run migration 009.
    runMigrations(db, 9);

    const rows = db.prepare('SELECT id, source, plugin_id, external_id FROM tasks ORDER BY id').all() as Array<{
      id: string;
      source: string;
      plugin_id: string | null;
      external_id: string | null;
    }>;
    expect(rows).toEqual([
      { id: 'a', source: 'plugin', plugin_id: 'ado', external_id: '111' },
      { id: 'b', source: 'plugin', plugin_id: 'ado', external_id: '222' },
    ]);
    db.close();
  });

  it('leaves plugin_id NULL when source=ado but the plugins row is missing', () => {
    const db = openDbAt(8);
    // No plugins row, but a legacy source='ado' task exists.
    db.prepare(
      "INSERT INTO tasks (id, title, source, external_id) VALUES ('orphan', 'O', 'ado', '7')",
    ).run();

    runMigrations(db, 9);

    const row = db
      .prepare('SELECT source, plugin_id FROM tasks WHERE id = ?')
      .get('orphan') as { source: string; plugin_id: string | null };
    expect(row).toEqual({ source: 'plugin', plugin_id: null });
    db.close();
  });

  it('unique index rejects duplicate (plugin_id, external_id)', () => {
    const db = openDbAt(9);
    db.prepare(
      `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
       VALUES ('ado', 'ADO', '1.0.0', 1, '{}', datetime('now'), 'bundled')`,
    ).run();
    db.prepare(
      "INSERT INTO tasks (id, title, source, plugin_id, external_id) VALUES ('a', 'A', 'plugin', 'ado', '123')",
    ).run();
    expect(() =>
      db.prepare(
        "INSERT INTO tasks (id, title, source, plugin_id, external_id) VALUES ('b', 'B', 'plugin', 'ado', '123')",
      ).run(),
    ).toThrow(/UNIQUE/);
    db.close();
  });

  it('same external_id under different pluginIds is allowed', () => {
    const db = openDbAt(9);
    db.prepare(
      `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
       VALUES ('ado', 'ADO', '1.0.0', 1, '{}', datetime('now'), 'bundled')`,
    ).run();
    db.prepare(
      `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
       VALUES ('jira', 'Jira', '1.0.0', 1, '{}', datetime('now'), 'sideloaded')`,
    ).run();
    db.prepare(
      "INSERT INTO tasks (id, title, source, plugin_id, external_id) VALUES ('a', 'A', 'plugin', 'ado', '123')",
    ).run();
    db.prepare(
      "INSERT INTO tasks (id, title, source, plugin_id, external_id) VALUES ('b', 'B', 'plugin', 'jira', '123')",
    ).run();

    const count = (
      db.prepare('SELECT COUNT(*) as n FROM tasks').get() as { n: number }
    ).n;
    expect(count).toBe(2);
    db.close();
  });

  it("rejects 'ado' as a source value via CHECK constraint", () => {
    const db = openDbAt(9);
    expect(() =>
      db.prepare(
        "INSERT INTO tasks (id, title, source) VALUES ('x', 'X', 'ado')",
      ).run(),
    ).toThrow(/CHECK/);
    db.close();
  });

  it('FK on plugin_id is enforced (RESTRICT) — raw plugin delete with refs fails', () => {
    const db = openDbAt(9);
    db.prepare(
      `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
       VALUES ('ado', 'ADO', '1.0.0', 1, '{}', datetime('now'), 'sideloaded')`,
    ).run();
    db.prepare(
      "INSERT INTO tasks (id, title, source, plugin_id, external_id) VALUES ('a', 'A', 'plugin', 'ado', '1')",
    ).run();
    expect(() => db.prepare("DELETE FROM plugins WHERE id = 'ado'").run()).toThrow(
      /FOREIGN KEY/i,
    );
    db.close();
  });

  it('records schema_version 9', () => {
    const db = openDbAt(9);
    const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[];
    expect(rows.map((r) => r.version)).toContain(9);
    db.close();
  });

  it('time_entries and comments retain CASCADE FK to tasks after rebuild', () => {
    const db = openDbAt(9);
    db.prepare("INSERT INTO tasks (id, title) VALUES ('t1', 'T1')").run();
    db.prepare(
      "INSERT INTO time_entries (id, task_id, start_time) VALUES ('e1', 't1', datetime('now'))",
    ).run();
    db.prepare(
      "INSERT INTO comments (id, task_id, body) VALUES ('c1', 't1', 'hi')",
    ).run();

    db.prepare("DELETE FROM tasks WHERE id = 't1'").run();
    expect((db.prepare('SELECT COUNT(*) as n FROM time_entries').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) as n FROM comments').get() as { n: number }).n).toBe(0);
    db.close();
  });
});
