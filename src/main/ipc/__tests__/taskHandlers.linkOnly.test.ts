import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import {
  createTask,
  updateTask,
  linkTaskToPlugin,
  upsertExternalTask,
  getTaskById,
} from '../taskHandlers';

function installAdoPlugin(db: Database): void {
  db.instance
    .prepare(
      `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
       VALUES ('ado', 'ADO', '1.0.0', 1, '{}', datetime('now'), 'sideloaded')`,
    )
    .run();
}

/**
 * Regression: `upsertExternalTask` matched on (plugin_id, external_id) with no
 * check on `source`, so a pull overwrote the user-authored title and notes of a
 * task linked with mode='link' — which `linkTaskToPlugin` documents as
 * user-owned and never pulled into.
 */
describe('upsertExternalTask against a link-only task', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    installAdoPlugin(db);
  });

  afterEach(() => {
    db.close();
  });

  it('preserves user-authored title, notes and status on a link-only task', () => {
    const task = createTask(db, {
      title: 'Investigate login flake',
      status: 'in-progress',
    });
    updateTask(db, task.id, { notes: 'my own notes' });
    linkTaskToPlugin(db, task.id, { pluginId: 'ado', externalId: '123', mode: 'link' });

    upsertExternalTask(db, {
      pluginId: 'ado',
      externalId: '123',
      title: '#123 - Remote work item title',
      notes: 'remote description from ADO',
      description: 'remote description',
      status: 'todo',
    });

    const after = getTaskById(db, task.id)!;
    expect(after.title).toBe('Investigate login flake');
    expect(after.notes).toBe('my own notes');
    expect(after.status).toBe('in-progress');
    expect(after.source).not.toBe('plugin');
  });

  it('still refreshes remote metadata columns on a link-only task', () => {
    const task = createTask(db, { title: 'Local title' });
    linkTaskToPlugin(db, task.id, { pluginId: 'ado', externalId: '456', mode: 'link' });

    upsertExternalTask(db, {
      pluginId: 'ado',
      externalId: '456',
      title: 'remote',
      externalUrl: 'https://ado.example/456',
      externalState: 'Active',
    });

    const after = getTaskById(db, task.id)!;
    expect(after.title).toBe('Local title');
    expect(after.externalUrl).toBe('https://ado.example/456');
    expect(after.externalState).toBe('Active');
  });

  it('does not create a duplicate row for the same (pluginId, externalId)', () => {
    const task = createTask(db, { title: 'Local title' });
    linkTaskToPlugin(db, task.id, { pluginId: 'ado', externalId: '789', mode: 'link' });

    upsertExternalTask(db, { pluginId: 'ado', externalId: '789', title: 'remote' });

    const count = db.instance
      .prepare("SELECT COUNT(*) as n FROM tasks WHERE plugin_id = 'ado' AND external_id = '789'")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('still overwrites title and notes for a full mirror', () => {
    const task = createTask(db, { title: 'Local title' });
    updateTask(db, task.id, { notes: 'local notes' });
    linkTaskToPlugin(db, task.id, { pluginId: 'ado', externalId: '999', mode: 'mirror' });

    upsertExternalTask(db, {
      pluginId: 'ado',
      externalId: '999',
      title: '#999 - Remote title',
      notes: 'remote notes',
    });

    const after = getTaskById(db, task.id)!;
    expect(after.title).toBe('#999 - Remote title');
    expect(after.notes).toBe('remote notes');
  });
});
