import type BetterSqlite3 from 'better-sqlite3';

export const MIGRATIONS: readonly string[] = [
  // Migration 001: Initial schema
  `
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

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    syncable INTEGER NOT NULL DEFAULT 0,
    synced INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6b7280',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_categories (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, category_id)
  );

  CREATE TABLE IF NOT EXISTS plugin_config (
    plugin_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (plugin_id, key)
  );

  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );

  INSERT OR IGNORE INTO schema_version (version) VALUES (1);
  `,
  // Migration 002: Add notes column to tasks
  `
  ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT '';
  INSERT OR IGNORE INTO schema_version (version) VALUES (2);
  `,
  // Migration 003: Add indexes for paginated queries
  `
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_status_sort ON tasks(status, sort_order ASC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_time_entries_task_start ON time_entries(task_id, start_time DESC);
  INSERT OR IGNORE INTO schema_version (version) VALUES (3);
  `,
  // Migration 004: Soft-delete support (recycle bin)
  `
  ALTER TABLE tasks ADD COLUMN deleted_at TEXT DEFAULT NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);
  INSERT OR IGNORE INTO schema_version (version) VALUES (4);
  `,
  // Migration 005: Plugin registry (metadata for installed plugins)
  `
  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    manifest TEXT NOT NULL DEFAULT '{}',
    installed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT OR IGNORE INTO schema_version (version) VALUES (5);
  `,
  // Migration 006: Reported-at on time entries (manually marked today;
  // future ADO plugin will set automatically on push).
  `
  ALTER TABLE time_entries ADD COLUMN reported_at TEXT DEFAULT NULL;
  CREATE INDEX IF NOT EXISTS idx_time_entries_reported_at ON time_entries(reported_at);
  INSERT OR IGNORE INTO schema_version (version) VALUES (6);
  `,
  // Migration 007: ADO plugin support — external mirror fields on tasks +
  // external_id on comments. `state_dirty` flags ct-side status changes that
  // haven't been pushed to the external system yet.
  `
  ALTER TABLE comments ADD COLUMN external_id TEXT;
  ALTER TABLE tasks ADD COLUMN external_url TEXT;
  ALTER TABLE tasks ADD COLUMN external_state TEXT;
  ALTER TABLE tasks ADD COLUMN external_completed_hours REAL;
  ALTER TABLE tasks ADD COLUMN external_refreshed_at TEXT;
  ALTER TABLE tasks ADD COLUMN state_dirty INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source_external
    ON tasks(source, external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_comments_external_id
    ON comments(external_id) WHERE external_id IS NOT NULL;
  INSERT OR IGNORE INTO schema_version (version) VALUES (7);
  `,
  // Migration 008: Distinguish bundled (ships in app) from sideloaded
  // (`ct plugin install`) plugins. Default 'sideloaded' so existing rows
  // backfill safely; bundled registrar sets 'bundled' explicitly on insert.
  `
  ALTER TABLE plugins ADD COLUMN source TEXT NOT NULL DEFAULT 'sideloaded';
  INSERT OR IGNORE INTO schema_version (version) VALUES (8);
  `,
  // Migration 009: Decouple TaskSource from ADO; key external tasks by
  // plugin_id. SQLite needs a table recreation to add a FK to an existing
  // column. Backfill source='ado' rows to source='plugin', plugin_id='ado'
  // (only when the plugins.ado row exists; else plugin_id stays NULL so
  // the FK constraint holds). Replace idx_tasks_source_external with
  // idx_tasks_plugin_external. Tighten source to the closed enum via CHECK.
  `
  PRAGMA foreign_keys = OFF;

  CREATE TABLE tasks_new (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    source TEXT NOT NULL DEFAULT 'ad-hoc'
      CHECK (source IN ('ad-hoc', 'email', 'meeting-prep', 'plugin')),
    external_id TEXT,
    plugin_id TEXT REFERENCES plugins(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    deleted_at TEXT DEFAULT NULL,
    external_url TEXT,
    external_state TEXT,
    external_completed_hours REAL,
    external_refreshed_at TEXT,
    state_dirty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT INTO tasks_new (
    id, title, description, status, source, external_id, plugin_id, sort_order,
    notes, deleted_at, external_url, external_state, external_completed_hours,
    external_refreshed_at, state_dirty, created_at, updated_at
  )
  SELECT
    id, title, description, status,
    CASE WHEN source = 'ado' THEN 'plugin' ELSE source END,
    external_id,
    CASE
      WHEN source = 'ado' AND EXISTS (SELECT 1 FROM plugins WHERE id = 'ado')
        THEN 'ado'
      WHEN source = 'ado'
        THEN NULL
      ELSE plugin_id
    END,
    sort_order, notes, deleted_at, external_url, external_state,
    external_completed_hours, external_refreshed_at, state_dirty,
    created_at, updated_at
  FROM tasks;

  DROP TABLE tasks;
  ALTER TABLE tasks_new RENAME TO tasks;

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_status_sort ON tasks(status, sort_order ASC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);
  CREATE UNIQUE INDEX idx_tasks_plugin_external
    ON tasks(plugin_id, external_id) WHERE external_id IS NOT NULL;

  PRAGMA foreign_keys = ON;

  INSERT OR IGNORE INTO schema_version (version) VALUES (9);
  `,
];

export function runMigrations(db: BetterSqlite3.Database, upTo?: number): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');

  const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as
    | { version: number | null }
    | undefined;
  const currentVersion = row?.version ?? 0;
  const target = upTo ?? MIGRATIONS.length;

  for (let i = currentVersion; i < Math.min(target, MIGRATIONS.length); i++) {
    db.exec(MIGRATIONS[i]);
  }
}
