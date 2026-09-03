import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { runMigrations, MigrationError, MIGRATIONS } from '../migrations';

// The runner's failure behavior can only be exercised with a migration that
// fails, so these tests append one and pop it again. MIGRATIONS is readonly to
// callers; the cast is deliberate and scoped to this file.
const mutable = MIGRATIONS as string[];

/**
 * Review tier 3: migrations ran as bare `db.exec`, so each statement committed
 * on its own. A failure partway left the schema half-applied with the
 * `schema_version` row unwritten — so the next launch re-ran the same
 * migration, hit the already-applied half, and threw again. Permanently, with
 * nothing catching it in `main.ts`.
 */
describe('migration atomicity', () => {
  it('applies every migration and ends with foreign keys enforced', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
    expect(version).toBe(MIGRATIONS.length);
    // Migration 009 turns foreign keys off to rebuild `tasks`; the runner is
    // responsible for turning them back on outside the transaction.
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('rolls the whole migration back when a statement in it fails', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const before = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const versionBefore = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;

    // A migration that creates a table and then fails, the shape of a real
    // half-applied migration.
    const broken = `
      CREATE TABLE should_not_survive (id TEXT PRIMARY KEY);
      INSERT INTO no_such_table (id) VALUES ('x');
      INSERT OR IGNORE INTO schema_version (version) VALUES (${MIGRATIONS.length + 1});
    `;
    mutable.push(broken);
    try {
      expect(() => runMigrations(db)).toThrow(MigrationError);

      const after = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[];
      // Before the fix, `should_not_survive` was committed and left behind.
      expect(after.map((t) => t.name)).toEqual(before.map((t) => t.name));

      const versionAfter = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
      expect(versionAfter).toBe(versionBefore);
    } finally {
      mutable.pop();
      db.close();
    }
  });

  it('names the migration that failed', () => {
    const db = new BetterSqlite3(':memory:');
    runMigrations(db);
    mutable.push('SELECT this_is_not_valid_sql(;');
    try {
      runMigrations(db);
      expect.unreachable('expected a MigrationError');
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationError);
      expect((err as MigrationError).version).toBe(MIGRATIONS.length);
      expect((err as MigrationError).message).toContain(
        `Migration ${String(MIGRATIONS.length).padStart(3, '0')} failed`,
      );
    } finally {
      mutable.pop();
      db.close();
    }
  });

  it('re-running after a failure still applies the migration once it is fixed', () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    mutable.push(`
      CREATE TABLE late_addition (id TEXT PRIMARY KEY);
      INSERT INTO no_such_table (id) VALUES ('x');
      INSERT OR IGNORE INTO schema_version (version) VALUES (${MIGRATIONS.length + 1});
    `);
    expect(() => runMigrations(db)).toThrow(MigrationError);

    // Fix the migration and re-run, as a patched app relaunch would. This is
    // the case that used to be unrecoverable: the CREATE TABLE had committed,
    // so the retry died on "table already exists" forever.
    mutable[mutable.length - 1] = `
      CREATE TABLE late_addition (id TEXT PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version (version) VALUES (${MIGRATIONS.length});
    `;
    try {
      expect(() => runMigrations(db)).not.toThrow();
      const version = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
      expect(version).toBe(MIGRATIONS.length);
    } finally {
      mutable.pop();
      db.close();
    }
  });
});
