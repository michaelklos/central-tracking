import BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from './migrations';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    // WAL is meaningless for `:memory:` (no files to journal) and emits a
    // misleading "ok" — skip it so tests don't suggest a mode they didn't get.
    if (dbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    runMigrations(this.db);
  }

  get instance(): BetterSqlite3.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
