import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../database/database';
import {
  installPlugin, uninstallPlugin, listPlugins, getPlugin, setPluginEnabled,
  getPluginConfig, setPluginConfig, listPluginConfig, deletePluginConfig,
  getWebhookSubscribers, validatePluginManifest,
} from '../pluginHandlers';

describe('pluginHandlers', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
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
      expect(listPluginConfig(db, 'p')).toEqual([{ pluginId: 'p', key: 'k', value: 'v2' }]);
    });

    it('delete removes a key', () => {
      installPlugin(db, { id: 'p', name: 'P', version: '1' });
      setPluginConfig(db, 'p', 'k', 'v');
      deletePluginConfig(db, 'p', 'k');
      expect(getPluginConfig(db, 'p', 'k')).toBeNull();
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
