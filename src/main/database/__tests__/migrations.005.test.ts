import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../migrations';

describe('Migration 005 - Plugin registry', () => {
  it('creates plugins table with expected columns', () => {
    const db = new BetterSqlite3(':memory:');
    runMigrations(db);

    const columns = db.pragma('table_info(plugins)') as { name: string }[];
    const names = columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['id', 'name', 'version', 'enabled', 'manifest', 'installed_at']),
    );
    db.close();
  });

  it('plugins row persists with correct defaults', () => {
    const db = new BetterSqlite3(':memory:');
    runMigrations(db);

    db.prepare("INSERT INTO plugins (id, name, version, manifest) VALUES ('p1', 'P1', '1.0.0', '{}')").run();
    const row = db.prepare('SELECT id, enabled, installed_at FROM plugins WHERE id = ?').get('p1') as {
      id: string;
      enabled: number;
      installed_at: string;
    };
    expect(row.id).toBe('p1');
    expect(row.enabled).toBe(1);
    expect(row.installed_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    db.close();
  });

  it('records schema_version 5', () => {
    const db = new BetterSqlite3(':memory:');
    runMigrations(db);
    const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[];
    expect(rows.map((r) => r.version)).toContain(5);
    db.close();
  });
});
