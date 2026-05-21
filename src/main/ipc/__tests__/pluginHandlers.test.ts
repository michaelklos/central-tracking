import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Database } from '../../database/database';
import {
  electronMockFactory,
  resetMockSafeStorage,
  setSafeStorageAvailable,
} from '../../../test/mocks/safeStorage';

vi.mock('electron', () => electronMockFactory());

import {
  installPlugin, uninstallPlugin, listPlugins, getPlugin, setPluginEnabled,
  getPluginCapabilities,
  getPluginConfig, setPluginConfig, listPluginConfig, deletePluginConfig,
  getWebhookSubscribers, validatePluginManifest,
  getPluginConfigSchema, registerBundledPlugin,
} from '../pluginHandlers';
import { DomainError } from '../../errors';

describe('pluginHandlers', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    resetMockSafeStorage();
  });

  afterEach(() => {
    db.close();
  });

  describe('validatePluginManifest', () => {
    it('accepts a minimal manifest', () => {
      const m = validatePluginManifest({ id: 'ado', name: 'ADO Sync', version: '0.1.0' });
      expect(m.id).toBe('ado');
    });

    it('rejects missing id', () => {
      expect(() => validatePluginManifest({ name: 'x', version: '1' })).toThrow(/id/);
    });

    it('rejects non-loopback webhook urls', () => {
      expect(() =>
        validatePluginManifest({
          id: 'bad',
          name: 'Bad',
          version: '1',
          webhook: { url: 'http://evil.example.com/hook' },
        }),
      ).toThrow(/loopback/);
    });

    it('accepts loopback webhook urls', () => {
      const m = validatePluginManifest({
        id: 'good',
        name: 'Good',
        version: '1',
        webhook: { url: 'http://127.0.0.1:9901/hook' },
      });
      expect(m.webhook?.url).toBe('http://127.0.0.1:9901/hook');
    });

    it('rejects events that are not string arrays', () => {
      expect(() =>
        validatePluginManifest({ id: 'x', name: 'x', version: '1', events: [1, 2] }),
      ).toThrow(/events/);
    });

    it('accepts well-formed configSchema', () => {
      const m = validatePluginManifest({
        id: 'x', name: 'X', version: '1',
        configSchema: {
          pat:   { required: true,  secret: true,  description: 'Token' },
          host:  { required: true,  secret: false },
          extra: { required: false, secret: false, description: 'opt' },
        },
      });
      expect(m.configSchema?.pat.secret).toBe(true);
      expect(m.configSchema?.host.required).toBe(true);
      expect(m.configSchema?.extra.description).toBe('opt');
    });

    it('rejects configSchema that is not an object', () => {
      expect(() =>
        validatePluginManifest({ id: 'x', name: 'x', version: '1', configSchema: [] }),
      ).toThrow(/configSchema/);
    });

    it('rejects configSchema entries missing required:boolean', () => {
      expect(() =>
        validatePluginManifest({
          id: 'x', name: 'x', version: '1',
          configSchema: { pat: { secret: true } },
        }),
      ).toThrow(/required/);
    });

    it('rejects configSchema entries missing secret:boolean', () => {
      expect(() =>
        validatePluginManifest({
          id: 'x', name: 'x', version: '1',
          configSchema: { pat: { required: true } },
        }),
      ).toThrow(/secret/);
    });

    it('rejects configSchema with bad key alphabet', () => {
      expect(() =>
        validatePluginManifest({
          id: 'x', name: 'x', version: '1',
          configSchema: { 'BAD KEY': { required: true, secret: false } },
        }),
      ).toThrow(/configSchema key/);
    });
  });

  describe('install/list/uninstall', () => {
    it('install persists a plugin and returns it', () => {
      const plugin = installPlugin(db, { id: 'sync', name: 'Sync', version: '1.0.0' });
      expect(plugin.id).toBe('sync');
      expect(plugin.enabled).toBe(true);
      expect(getPlugin(db, 'sync')?.name).toBe('Sync');
    });

    it('installing an existing id updates in place', () => {
      installPlugin(db, { id: 'p', name: 'Old', version: '0.1.0' });
      installPlugin(db, { id: 'p', name: 'New', version: '0.2.0' });
      expect(listPlugins(db)).toHaveLength(1);
      expect(getPlugin(db, 'p')?.version).toBe('0.2.0');
    });

    it('uninstall preflight reports the task count without deleting', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      setPluginConfig(db, 'p', 'api-key', 'secret');
      const result = uninstallPlugin(db, 'p');
      expect(result).toEqual({ requiresConfirmation: true, taskCount: 0 });
      expect(getPlugin(db, 'p')).not.toBeNull();
      expect(listPluginConfig(db, 'p')).toHaveLength(1);
    });

    it('uninstall with convertTasksToAdHoc removes plugin and its config', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      setPluginConfig(db, 'p', 'api-key', 'secret');
      const result = uninstallPlugin(db, 'p', { convertTasksToAdHoc: true });
      expect(result).toEqual({ uninstalled: true, convertedTasks: 0 });
      expect(getPlugin(db, 'p')).toBeNull();
      expect(listPluginConfig(db, 'p')).toEqual([]);
    });

    it('install tags rows source=sideloaded', () => {
      const p = installPlugin(db, { id: 's', name: 'S', version: '1' });
      expect(p.source).toBe('sideloaded');
    });

    it('accepts manifest with env field', () => {
      const m = validatePluginManifest({
        id: 'e', name: 'E', version: '1',
        env: { ELECTRON_RUN_AS_NODE: '1', FOO: 'bar' },
      });
      expect(m.env?.ELECTRON_RUN_AS_NODE).toBe('1');
    });

    it('rejects non-string env values', () => {
      expect(() =>
        validatePluginManifest({ id: 'e', name: 'E', version: '1', env: { K: 1 } }),
      ).toThrow(/env/);
    });

    it('accepts entrypointArgv array', () => {
      const m = validatePluginManifest({
        id: 'a', name: 'A', version: '1',
        entrypointArgv: ['/abs/electron', '/abs/script.js'],
      });
      expect(m.entrypointArgv).toEqual(['/abs/electron', '/abs/script.js']);
    });

    it('rejects empty entrypointArgv', () => {
      expect(() =>
        validatePluginManifest({ id: 'a', name: 'A', version: '1', entrypointArgv: [] }),
      ).toThrow(/entrypointArgv/);
    });

    it('accepts a plain-object capabilities map', () => {
      const m = validatePluginManifest({
        id: 'c', name: 'C', version: '1',
        capabilities: { tracksReported: true, foo: 'bar', nested: { ok: 1 } },
      });
      expect(m.capabilities?.tracksReported).toBe(true);
    });

    it('rejects capabilities that is not an object', () => {
      expect(() =>
        validatePluginManifest({ id: 'c', name: 'C', version: '1', capabilities: 'nope' }),
      ).toThrow(/capabilities/);
    });

    it('rejects capabilities that is an array', () => {
      expect(() =>
        validatePluginManifest({ id: 'c', name: 'C', version: '1', capabilities: [1, 2] }),
      ).toThrow(/capabilities/);
    });

    it('rejects capabilities backed by a non-plain class instance', () => {
      // Manifests parsed from plugin.json can't produce a Date — but
      // registerBundledPlugin takes an in-process object and a careless
      // caller could hand over a class instance. Defensive guard.
      expect(() =>
        validatePluginManifest({
          id: 'c', name: 'C', version: '1', capabilities: new Date() as unknown as Record<string, unknown>,
        }),
      ).toThrow(/capabilities/);
      expect(() =>
        validatePluginManifest({
          id: 'c', name: 'C', version: '1', capabilities: new Map() as unknown as Record<string, unknown>,
        }),
      ).toThrow(/capabilities/);
    });

    it('accepts a null-prototype object as capabilities', () => {
      const caps = Object.create(null);
      caps.tracksReported = true;
      const m = validatePluginManifest({ id: 'c', name: 'C', version: '1', capabilities: caps });
      expect(m.capabilities?.tracksReported).toBe(true);
    });
  });

  describe('registerBundledPlugin', () => {
    it('inserts disabled + source=bundled on fresh install', () => {
      const p = registerBundledPlugin(db, { id: 'b', name: 'B', version: '1.0.0' });
      expect(p.enabled).toBe(false);
      expect(p.source).toBe('bundled');
    });

    it('is a no-op when the version matches', () => {
      registerBundledPlugin(db, { id: 'b', name: 'B', version: '1.0.0' });
      setPluginEnabled(db, 'b', true);
      registerBundledPlugin(db, { id: 'b', name: 'B', version: '1.0.0' });
      // Enabled preserved, no UPDATE fired.
      expect(getPlugin(db, 'b')?.enabled).toBe(true);
    });

    it('UPDATEs manifest on version bump but preserves enabled + source', () => {
      registerBundledPlugin(db, { id: 'b', name: 'B', version: '1.0.0' });
      setPluginEnabled(db, 'b', true);
      registerBundledPlugin(db, { id: 'b', name: 'B-renamed', version: '1.1.0' });
      const after = getPlugin(db, 'b');
      expect(after?.version).toBe('1.1.0');
      expect(after?.name).toBe('B-renamed');
      expect(after?.enabled).toBe(true);
      expect(after?.source).toBe('bundled');
    });

    it('blocks uninstall on bundled plugins', () => {
      registerBundledPlugin(db, { id: 'b', name: 'B', version: '1' });
      expect(() => uninstallPlugin(db, 'b')).toThrow(DomainError);
      expect(() => uninstallPlugin(db, 'b')).toThrow(/BUNDLED_PLUGIN_LOCKED|Bundled plugins/);
      // Bundled refusal still applies when convertTasksToAdHoc=true.
      expect(() => uninstallPlugin(db, 'b', { convertTasksToAdHoc: true })).toThrow(
        /BUNDLED_PLUGIN_LOCKED|Bundled plugins/,
      );
      expect(getPlugin(db, 'b')).not.toBeNull();
    });

    it('still allows uninstall on sideloaded plugins', () => {
      installPlugin(db, { id: 's', name: 'S', version: '1' });
      uninstallPlugin(db, 's', { convertTasksToAdHoc: true });
      expect(getPlugin(db, 's')).toBeNull();
    });
  });

  describe('uninstall with referencing tasks', () => {
    function seed(): void {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      const inst = db.instance;
      inst.prepare(
        `INSERT INTO tasks (id, title, source, plugin_id, external_id, external_url, external_state, external_completed_hours, external_refreshed_at, state_dirty)
         VALUES ('t1', 'T1', 'plugin', 'p', '101', 'https://x/1', 'Active', 2.5, datetime('now'), 1),
                ('t2', 'T2', 'plugin', 'p', '102', 'https://x/2', 'New',    null, datetime('now'), 0),
                ('t3', 'T3', 'plugin', 'p', '103', null,          null,    null, null,            0)`,
      ).run();
      inst.prepare(
        `INSERT INTO comments (id, task_id, body, syncable, synced, external_id)
         VALUES ('c1', 't1', 'mirrored',   0, 1, '999'),
                ('c2', 't1', 'local-only', 1, 0, null)`,
      ).run();
      inst.prepare(
        "INSERT INTO time_entries (id, task_id, start_time, end_time) VALUES ('e1', 't1', datetime('now'), datetime('now'))",
      ).run();
    }

    it('preflight returns the count without mutating', () => {
      seed();
      const result = uninstallPlugin(db, 'p');
      expect(result).toEqual({ requiresConfirmation: true, taskCount: 3 });
      expect(getPlugin(db, 'p')).not.toBeNull();
      const rows = db.instance.prepare("SELECT COUNT(*) as n FROM tasks WHERE plugin_id = 'p'").get() as { n: number };
      expect(rows.n).toBe(3);
    });

    it('convert transactionally clears external fields and deletes the plugin row', () => {
      seed();
      const result = uninstallPlugin(db, 'p', { convertTasksToAdHoc: true });
      expect(result).toEqual({ uninstalled: true, convertedTasks: 3 });
      expect(getPlugin(db, 'p')).toBeNull();

      const rows = db.instance
        .prepare('SELECT id, source, plugin_id, external_id, external_url, external_state, external_completed_hours, external_refreshed_at, state_dirty FROM tasks ORDER BY id')
        .all() as Array<{
          id: string;
          source: string;
          plugin_id: string | null;
          external_id: string | null;
          external_url: string | null;
          external_state: string | null;
          external_completed_hours: number | null;
          external_refreshed_at: string | null;
          state_dirty: number;
        }>;
      for (const r of rows) {
        expect(r.source).toBe('ad-hoc');
        expect(r.plugin_id).toBeNull();
        expect(r.external_id).toBeNull();
        expect(r.external_url).toBeNull();
        expect(r.external_state).toBeNull();
        expect(r.external_completed_hours).toBeNull();
        expect(r.external_refreshed_at).toBeNull();
        expect(r.state_dirty).toBe(0);
      }
    });

    it('convert clears comments.external_id on tasks owned by the plugin', () => {
      seed();
      uninstallPlugin(db, 'p', { convertTasksToAdHoc: true });
      const comments = db.instance
        .prepare('SELECT id, external_id FROM comments ORDER BY id')
        .all() as Array<{ id: string; external_id: string | null }>;
      expect(comments).toEqual([
        { id: 'c1', external_id: null },
        { id: 'c2', external_id: null },
      ]);
    });

    it('convert leaves time entries attached to the converted tasks', () => {
      seed();
      uninstallPlugin(db, 'p', { convertTasksToAdHoc: true });
      const n = (db.instance.prepare("SELECT COUNT(*) as n FROM time_entries WHERE task_id = 't1'").get() as { n: number }).n;
      expect(n).toBe(1);
    });

    it('FK on plugin_id is RESTRICT — raw plugin delete fails if a task refs it', () => {
      seed();
      expect(() => db.instance.prepare("DELETE FROM plugins WHERE id = 'p'").run()).toThrow(
        /FOREIGN KEY/i,
      );
    });

    it('preserves source on link-only tasks; only full-mirror rows reset to ad-hoc', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      db.instance
        .prepare(
          `INSERT INTO tasks (id, title, source, plugin_id, external_id, external_url, external_state)
           VALUES
             -- Full mirror: plugin owns it; convert should reset source.
             ('mirror', 'Mirror', 'plugin', 'p', '500', 'https://x/500', 'Active'),
             -- Link-only with source='ad-hoc': plugin_id and external_id are
             -- the only plugin-touched columns; source must survive.
             ('link-adhoc', 'Link AdHoc', 'ad-hoc', 'p', '501', null, null),
             -- Link-only with a non-default source: the convert MUST NOT
             -- rewrite the user-chosen provenance ('email', 'meeting-prep'
             -- etc.).
             ('link-email', 'Link Email', 'email', 'p', '502', null, null),
             ('link-meet',  'Link Meet',  'meeting-prep', 'p', '503', null, null)`,
        )
        .run();

      const result = uninstallPlugin(db, 'p', { convertTasksToAdHoc: true });
      expect(result).toEqual({ uninstalled: true, convertedTasks: 4 });

      const rows = db.instance
        .prepare('SELECT id, source, plugin_id, external_id, external_url, external_state FROM tasks ORDER BY id')
        .all() as Array<{
          id: string;
          source: string;
          plugin_id: string | null;
          external_id: string | null;
          external_url: string | null;
          external_state: string | null;
        }>;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

      // Full mirror: source reset, all mirror fields cleared.
      expect(byId.mirror.source).toBe('ad-hoc');
      expect(byId.mirror.plugin_id).toBeNull();
      expect(byId.mirror.external_id).toBeNull();
      expect(byId.mirror.external_url).toBeNull();
      expect(byId.mirror.external_state).toBeNull();

      // Link-only: source preserved, link cleared.
      expect(byId['link-adhoc'].source).toBe('ad-hoc');
      expect(byId['link-adhoc'].plugin_id).toBeNull();
      expect(byId['link-adhoc'].external_id).toBeNull();

      expect(byId['link-email'].source).toBe('email');
      expect(byId['link-email'].plugin_id).toBeNull();
      expect(byId['link-email'].external_id).toBeNull();

      expect(byId['link-meet'].source).toBe('meeting-prep');
      expect(byId['link-meet'].plugin_id).toBeNull();
      expect(byId['link-meet'].external_id).toBeNull();
    });
  });

  describe('getPluginCapabilities', () => {
    it('returns id/enabled/capabilities for every installed plugin', () => {
      installPlugin(db, {
        id: 'a',
        name: 'A',
        version: '1',
        capabilities: { tracksReported: false, customFlag: 'on' },
      });
      installPlugin(db, { id: 'b', name: 'B', version: '1' });
      setPluginEnabled(db, 'b', false);
      const caps = getPluginCapabilities(db);
      const byId = Object.fromEntries(caps.map((c) => [c.id, c]));
      expect(byId.a).toEqual({
        id: 'a',
        enabled: true,
        capabilities: { tracksReported: false, customFlag: 'on' },
      });
      expect(byId.b).toEqual({ id: 'b', enabled: false, capabilities: {} });
    });

    it('defaults to {} when the manifest declares no capabilities', () => {
      installPlugin(db, { id: 'no-caps', name: 'NoCaps', version: '1' });
      const caps = getPluginCapabilities(db);
      expect(caps.find((c) => c.id === 'no-caps')?.capabilities).toEqual({});
    });
  });

  describe('setPluginEnabled', () => {
    it('toggles enabled state', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      setPluginEnabled(db, 'p', false);
      expect(getPlugin(db, 'p')?.enabled).toBe(false);
      setPluginEnabled(db, 'p', true);
      expect(getPlugin(db, 'p')?.enabled).toBe(true);
    });

    it('throws on unknown plugin', () => {
      expect(() => setPluginEnabled(db, 'nope', true)).toThrow(/not found/);
    });

    it('refuses to enable when required config keys are unset (INCOMPLETE_CONFIG)', () => {
      installPlugin(db, {
        id: 'gated',
        name: 'Gated',
        version: '1',
        configSchema: {
          pat: { required: true, secret: true, description: 'Token' },
          host: { required: true, secret: false },
          extra: { required: false, secret: false },
        },
      });
      // Disable to start; that path must NEVER throw.
      setPluginEnabled(db, 'gated', false);
      expect(getPlugin(db, 'gated')?.enabled).toBe(false);

      let captured: unknown;
      try {
        setPluginEnabled(db, 'gated', true);
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(DomainError);
      expect((captured as DomainError).code).toBe('INCOMPLETE_CONFIG');
      // Error message lists every missing required key.
      expect((captured as DomainError).message).toMatch(/pat/);
      expect((captured as DomainError).message).toMatch(/host/);
      // And points the user at the fix.
      expect((captured as DomainError).message).toMatch(/ct plugin config set gated/);

      // Row stayed disabled.
      expect(getPlugin(db, 'gated')?.enabled).toBe(false);
    });

    it('disabling never gates on config (even if required keys are missing)', () => {
      installPlugin(db, {
        id: 'gated',
        name: 'Gated',
        version: '1',
        configSchema: { pat: { required: true, secret: true } },
      });
      // Default after install: enabled=1 + no config. Disabling must succeed.
      expect(() => setPluginEnabled(db, 'gated', false)).not.toThrow();
      expect(getPlugin(db, 'gated')?.enabled).toBe(false);
    });

    it('enabling succeeds once every required key has a value', () => {
      installPlugin(db, {
        id: 'gated',
        name: 'Gated',
        version: '1',
        configSchema: {
          host: { required: true, secret: false },
        },
      });
      setPluginEnabled(db, 'gated', false);
      expect(() => setPluginEnabled(db, 'gated', true)).toThrow(/INCOMPLETE_CONFIG|host/);
      setPluginConfig(db, 'gated', 'host', 'example.com');
      expect(() => setPluginEnabled(db, 'gated', true)).not.toThrow();
      expect(getPlugin(db, 'gated')?.enabled).toBe(true);
    });
  });

  describe('plugin_config', () => {
    it('round-trips a config value', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      setPluginConfig(db, 'p', 'k', 'v');
      expect(getPluginConfig(db, 'p', 'k')).toBe('v');
    });

    it('updates existing key instead of inserting duplicate', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      setPluginConfig(db, 'p', 'k', 'v1');
      setPluginConfig(db, 'p', 'k', 'v2');
      expect(listPluginConfig(db, 'p')).toEqual([
        { pluginId: 'p', key: 'k', value: 'v2', secret: false, stored: 'plaintext' },
      ]);
    });

    it('delete removes a key', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      setPluginConfig(db, 'p', 'k', 'v');
      deletePluginConfig(db, 'p', 'k');
      expect(getPluginConfig(db, 'p', 'k')).toBeNull();
    });
  });

  describe('secret config', () => {
    function installWithSchema() {
      installPlugin(db, {
        id: 'p', name: 'P', version: '1',
        configSchema: {
          pat:  { required: true,  secret: true,  description: 'Token' },
          host: { required: true,  secret: false, description: 'Host' },
        },
      });
    }

    it('encrypts a declared-secret key on write and decrypts on read', () => {
      installWithSchema();
      const res = setPluginConfig(db, 'p', 'pat', 'super-secret');
      expect(res.stored).toBe('encrypted');

      // On-disk value carries the sentinel and is not the plaintext.
      const raw = (db.instance.prepare('SELECT value FROM plugin_config WHERE plugin_id=? AND key=?')
        .get('p', 'pat') as { value: string }).value;
      expect(raw.startsWith('enc:v1:')).toBe(true);
      expect(raw).not.toContain('super-secret');

      // getPluginConfig decrypts.
      expect(getPluginConfig(db, 'p', 'pat')).toBe('super-secret');
    });

    it('stores undeclared key as plaintext by default', () => {
      installWithSchema();
      const res = setPluginConfig(db, 'p', 'host', 'example.com');
      expect(res.stored).toBe('plaintext');
      expect(getPluginConfig(db, 'p', 'host')).toBe('example.com');
    });

    it('honours opts.secret=true even when manifest does not declare', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' }); // no schema
      const res = setPluginConfig(db, 'p', 'mysecret', 'value', { secret: true });
      expect(res.stored).toBe('encrypted');
      expect(getPluginConfig(db, 'p', 'mysecret')).toBe('value');
    });

    it('throws NO_KEYRING when secret + keyring unavailable + no allowPlaintext', () => {
      installWithSchema();
      setSafeStorageAvailable(false);
      expect(() => setPluginConfig(db, 'p', 'pat', 'x')).toThrow(DomainError);
      try {
        setPluginConfig(db, 'p', 'pat', 'x');
      } catch (err) {
        expect((err as DomainError).code).toBe('NO_KEYRING');
      }
      // Row was not written.
      expect(getPluginConfig(db, 'p', 'pat')).toBeNull();
    });

    it('falls back to plaintext + warning when allowPlaintext=true', () => {
      installWithSchema();
      setSafeStorageAvailable(false);
      const res = setPluginConfig(db, 'p', 'pat', 'plain-token', { allowPlaintext: true });
      expect(res.stored).toBe('plaintext');
      expect(res.warning).toBeTruthy();
      expect(getPluginConfig(db, 'p', 'pat')).toBe('plain-token');
    });

    it('listPluginConfig flags declared-secret rows still in plaintext', () => {
      installWithSchema();
      // Manually insert plaintext for a secret key (simulates legacy or --allow-plaintext).
      db.instance.prepare('INSERT INTO plugin_config (plugin_id, key, value) VALUES (?, ?, ?)')
        .run('p', 'pat', 'legacy-token');
      const entries = listPluginConfig(db, 'p');
      const pat = entries.find((e) => e.key === 'pat')!;
      expect(pat.secret).toBe(true);
      expect(pat.stored).toBe('plaintext');
      expect(pat.value).toBe('legacy-token');
    });

    it('listPluginConfig returns encrypted rows with cleartext value (boundary masks)', () => {
      installWithSchema();
      setPluginConfig(db, 'p', 'pat', 'tok');
      const entries = listPluginConfig(db, 'p');
      const pat = entries.find((e) => e.key === 'pat')!;
      expect(pat.secret).toBe(true);
      expect(pat.stored).toBe('encrypted');
      expect(pat.value).toBe('tok'); // handler returns cleartext; bridge masks
    });
  });

  describe('getPluginConfigSchema', () => {
    it('merges manifest declarations with DB state', () => {
      installPlugin(db, {
        id: 'p', name: 'P', version: '1',
        configSchema: {
          pat:  { required: true,  secret: true,  description: 'Token' },
          host: { required: true,  secret: false, description: 'Host' },
          tag:  { required: false, secret: false, description: 'Tag'  },
        },
      });
      setPluginConfig(db, 'p', 'pat', 'tok');         // encrypted
      setPluginConfig(db, 'p', 'host', 'example.com'); // plaintext
      // tag unset

      const schema = getPluginConfigSchema(db, 'p');
      const byKey = Object.fromEntries(schema.map((s) => [s.key, s]));

      expect(byKey.pat.status).toBe('encrypted');
      expect(byKey.pat.required).toBe(true);
      expect(byKey.pat.secret).toBe(true);
      expect(byKey.pat.envVarName).toBe('CT_PLUGIN_P_PAT');

      expect(byKey.host.status).toBe('set');
      expect(byKey.host.envVarName).toBeNull();

      expect(byKey.tag.status).toBe('unset');
      expect(byKey.tag.envVarName).toBeNull();
    });

    it('flags declared-secret plaintext rows as plaintext-secret', () => {
      installPlugin(db, {
        id: 'p', name: 'P', version: '1',
        configSchema: { pat: { required: true, secret: true } },
      });
      db.instance.prepare('INSERT INTO plugin_config (plugin_id, key, value) VALUES (?, ?, ?)')
        .run('p', 'pat', 'legacy');
      const schema = getPluginConfigSchema(db, 'p');
      expect(schema[0].status).toBe('plaintext-secret');
    });

    it('includes undeclared DB keys at the end', () => {
      installPlugin(db, {
        id: 'p', name: 'P', version: '1',
        configSchema: { host: { required: true, secret: false } },
      });
      setPluginConfig(db, 'p', 'host', 'example.com');
      setPluginConfig(db, 'p', 'extra', 'value'); // not in schema

      const schema = getPluginConfigSchema(db, 'p');
      const extra = schema.find((s) => s.key === 'extra')!;
      expect(extra.required).toBe(false);
      expect(extra.status).toBe('set');
    });

    it('envVarName upper-cases plugin id + key and replaces hyphens', () => {
      installPlugin(db, {
        id: 'my-tool', name: 'My', version: '1',
        configSchema: { 'api-key': { required: true, secret: true } },
      });
      const schema = getPluginConfigSchema(db, 'my-tool');
      expect(schema[0].envVarName).toBe('CT_PLUGIN_MY_TOOL_API_KEY');
    });
  });

  describe('getWebhookSubscribers', () => {
    it('returns only enabled plugins with a webhook url', () => {
      installPlugin(db, { id: 'no-hook', name: 'No Hook', version: '1' });
      installPlugin(db, {
        id: 'hooked',
        name: 'Hooked',
        version: '1',
        webhook: { url: 'http://127.0.0.1:9901/hook' },
        events: ['task.created'],
      });
      installPlugin(db, {
        id: 'disabled',
        name: 'Disabled',
        version: '1',
        webhook: { url: 'http://127.0.0.1:9902/hook' },
      });
      setPluginEnabled(db, 'disabled', false);

      const subs = getWebhookSubscribers(db);
      expect(subs.map((s) => s.pluginId)).toEqual(['hooked']);
      expect(subs[0].events).toEqual(['task.created']);
    });

    it('defaults to wildcard when no events listed', () => {
      installPlugin(db, {
        id: 'all',
        name: 'All',
        version: '1',
        webhook: { url: 'http://127.0.0.1:9903/hook' },
      });
      const subs = getWebhookSubscribers(db);
      expect(subs[0].events).toEqual(['*']);
    });
  });
});
