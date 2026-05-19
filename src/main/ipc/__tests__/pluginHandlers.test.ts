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
  getPluginConfig, setPluginConfig, listPluginConfig, deletePluginConfig,
  getWebhookSubscribers, validatePluginManifest,
  getPluginConfigSchema,
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

    it('uninstall removes plugin and its config', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      setPluginConfig(db, 'p', 'api-key', 'secret');
      uninstallPlugin(db, 'p');
      expect(getPlugin(db, 'p')).toBeNull();
      expect(listPluginConfig(db, 'p')).toEqual([]);
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
