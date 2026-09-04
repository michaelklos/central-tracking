import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import { DomainError } from '../../errors';
import { createTask, linkTaskToPlugin, deleteTask } from '../taskHandlers';

function installAdoPlugin(db: Database): void {
  db.instance
    .prepare(
      `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
       VALUES ('ado', 'ADO', '1.0.0', 1, '{}', datetime('now'), 'sideloaded')`,
    )
    .run();
}

/**
 * Two partial unique indexes cover external_id. Linking a second task to an
 * external id another task already holds used to hit them raw, surfacing
 * "UNIQUE constraint failed: tasks.plugin_id, tasks.external_id" to the user.
 */
describe('linkTaskToPlugin duplicate external id', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    installAdoPlugin(db);
  });

  afterEach(() => db.close());

  it('reports which task already holds the external id', () => {
    const first = createTask(db, { title: 'Already linked' });
    linkTaskToPlugin(db, first.id, { pluginId: 'ado', externalId: '123', mode: 'link' });

    const second = createTask(db, { title: 'Second' });
    try {
      linkTaskToPlugin(db, second.id, { pluginId: 'ado', externalId: '123', mode: 'link' });
      expect.unreachable('expected a conflict');
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      const de = err as DomainError;
      expect(de.code).toBe('CONFLICT');
      expect(de.httpStatus).toBe(409);
      expect(de.message).toContain('Already linked');
      expect(de.message).not.toContain('UNIQUE constraint');
    }
  });

  it('names the recycle bin when the holder is soft-deleted', () => {
    const first = createTask(db, { title: 'Binned' });
    linkTaskToPlugin(db, first.id, { pluginId: 'ado', externalId: '456', mode: 'link' });
    deleteTask(db, first.id);

    const second = createTask(db, { title: 'Second' });
    // The indexes do not exclude deleted rows, so this genuinely still collides.
    expect(() =>
      linkTaskToPlugin(db, second.id, { pluginId: 'ado', externalId: '456', mode: 'link' }),
    ).toThrow(/recycle bin/);
  });

  it('re-linking the same task to the same external id still works', () => {
    const task = createTask(db, { title: 'Idempotent' });
    linkTaskToPlugin(db, task.id, { pluginId: 'ado', externalId: '789', mode: 'link' });
    const again = linkTaskToPlugin(db, task.id, {
      pluginId: 'ado',
      externalId: '789',
      mode: 'mirror',
    });
    expect(again.externalId).toBe('789');
    expect(again.source).toBe('plugin');
  });

  it('a different external id on the same plugin is unaffected', () => {
    const first = createTask(db, { title: 'First' });
    linkTaskToPlugin(db, first.id, { pluginId: 'ado', externalId: '111', mode: 'link' });
    const second = createTask(db, { title: 'Second' });
    const linked = linkTaskToPlugin(db, second.id, {
      pluginId: 'ado',
      externalId: '222',
      mode: 'link',
    });
    expect(linked.externalId).toBe('222');
  });
});
