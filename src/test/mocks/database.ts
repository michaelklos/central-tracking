import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from '../../main/database/migrations';
import { Database } from '../../main/database/database';

/**
 * Creates an in-memory SQLite database with migrations applied.
 * Use for testing IPC handlers against a real (but ephemeral) database.
 */
export function createTestDatabase(): Database {
  // Use ':memory:' for in-memory DB
  const db = new Database(':memory:');
  return db;
}

/**
 * Creates a raw in-memory better-sqlite3 instance (no wrapper class).
 * Useful for migration-level tests.
 */
export function createRawTestDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
