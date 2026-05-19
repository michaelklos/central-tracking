import type { IpcMain } from 'electron';
import type { Database } from '../database/database';
import type { Plugin, PluginManifest, PluginConfigEntry } from '../../shared/types';

interface PluginRow {
  id: string;
  name: string;
  version: string;
  enabled: number;
  manifest: string;
  installed_at: string;
}

function rowToPlugin(row: PluginRow): Plugin {
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(row.manifest) as PluginManifest;
  } catch {
    manifest = { id: row.id, name: row.name, version: row.version };
  }
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    enabled: row.enabled === 1,
    manifest,
    installedAt: row.installed_at,
  };
}

/**
 * Lightweight manifest validation — checks only the fields the server relies on.
 * Webhook URLs must be loopback (127.0.0.1 or localhost) so plugins can't be
 * tricked into exfiltrating data to a remote host.
 */
export function validatePluginManifest(input: unknown): PluginManifest {
  if (!input || typeof input !== 'object') {
    throw new Error('Plugin manifest must be a JSON object');
  }
  const m = input as Record<string, unknown>;
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(m.id)) {
    throw new Error('Plugin manifest "id" must be a string matching [a-z0-9._-]');
  }
  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new Error('Plugin manifest "name" is required');
  }
  if (typeof m.version !== 'string') {
    throw new Error('Plugin manifest "version" is required');
  }
  if (m.entrypoint !== undefined && typeof m.entrypoint !== 'string') {
    throw new Error('Plugin manifest "entrypoint" must be a string');
  }
  if (m.events !== undefined) {
    if (!Array.isArray(m.events) || m.events.some((e) => typeof e !== 'string')) {
      throw new Error('Plugin manifest "events" must be an array of strings');
    }
  }
  if (m.webhook !== undefined) {
    if (!m.webhook || typeof m.webhook !== 'object') {
      throw new Error('Plugin manifest "webhook" must be an object with { url }');
    }
    const url = (m.webhook as Record<string, unknown>).url;
    if (typeof url !== 'string') {
      throw new Error('Plugin manifest "webhook.url" must be a string');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Plugin webhook URL is not a valid URL: ${url}`);
    }
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost' && parsed.hostname !== '[::1]') {
      throw new Error(`Plugin webhook URL must be loopback-only (got host "${parsed.hostname}")`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Plugin webhook URL must use http(s) (got "${parsed.protocol}")`);
    }
  }
  return m as unknown as PluginManifest;
}

export function installPlugin(db: Database, manifestInput: unknown): Plugin {
  const manifest = validatePluginManifest(manifestInput);
  const now = new Date().toISOString();

  const existing = db.instance.prepare('SELECT id FROM plugins WHERE id = ?').get(manifest.id) as { id: string } | undefined;
  if (existing) {
    db.instance
      .prepare('UPDATE plugins SET name = ?, version = ?, manifest = ? WHERE id = ?')
      .run(manifest.name, manifest.version, JSON.stringify(manifest), manifest.id);
  } else {
    db.instance
      .prepare('INSERT INTO plugins (id, name, version, enabled, manifest, installed_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(manifest.id, manifest.name, manifest.version, JSON.stringify(manifest), now);
  }
  return getPlugin(db, manifest.id) as Plugin;
}

export function uninstallPlugin(db: Database, id: string): void {
  db.instance.prepare('DELETE FROM plugin_config WHERE plugin_id = ?').run(id);
  db.instance.prepare('DELETE FROM plugins WHERE id = ?').run(id);
}

export function listPlugins(db: Database): Plugin[] {
  const rows = db.instance
    .prepare('SELECT * FROM plugins ORDER BY name ASC')
    .all() as PluginRow[];
  return rows.map(rowToPlugin);
}

export function getPlugin(db: Database, id: string): Plugin | null {
  const row = db.instance.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as PluginRow | undefined;
  return row ? rowToPlugin(row) : null;
}

export function setPluginEnabled(db: Database, id: string, enabled: boolean): Plugin {
  const res = db.instance.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  if (res.changes === 0) throw new Error(`Plugin not found: ${id}`);
  return getPlugin(db, id) as Plugin;
}

// ─── Plugin config (key/value per plugin) ─────────────────────────────────

export function getPluginConfig(db: Database, pluginId: string, key: string): string | null {
  const row = db.instance
    .prepare('SELECT value FROM plugin_config WHERE plugin_id = ? AND key = ?')
    .get(pluginId, key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setPluginConfig(db: Database, pluginId: string, key: string, value: string): void {
  db.instance
    .prepare(
      `INSERT INTO plugin_config (plugin_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(pluginId, key, value);
}

export function deletePluginConfig(db: Database, pluginId: string, key: string): void {
  db.instance.prepare('DELETE FROM plugin_config WHERE plugin_id = ? AND key = ?').run(pluginId, key);
}

export function listPluginConfig(db: Database, pluginId: string): PluginConfigEntry[] {
  const rows = db.instance
    .prepare('SELECT plugin_id, key, value FROM plugin_config WHERE plugin_id = ? ORDER BY key ASC')
    .all(pluginId) as Array<{ plugin_id: string; key: string; value: string }>;
  return rows.map((r) => ({ pluginId: r.plugin_id, key: r.key, value: r.value }));
}

// ─── Webhook subscribers ──────────────────────────────────────────────────

export interface WebhookSubscriber {
  pluginId: string;
  url: string;
  events: string[];
}

/** Returns enabled plugins that have a webhook URL configured. */
export function getWebhookSubscribers(db: Database): WebhookSubscriber[] {
  const plugins = listPlugins(db).filter((p) => p.enabled && p.manifest.webhook?.url);
  return plugins.map((p) => ({
    pluginId: p.id,
    url: p.manifest.webhook!.url,
    events: p.manifest.events ?? ['*'],
  }));
}

// ─── IPC registration ─────────────────────────────────────────────────────
//
// Plugin install/manage stays HTTP-only (CLI surface). The renderer needs
// read access to plugin config to drive UI rules sourced from plugins
// (e.g. the ADO state-map drives the TaskDetail status dropdown FSM).

export function registerPluginHandlers(ipcMain: IpcMain, db: Database): void {
  ipcMain.handle('plugins:list', () => listPlugins(db));
  ipcMain.handle('plugins:setEnabled', (_event, id: string, enabled: boolean) => setPluginEnabled(db, id, enabled));
  ipcMain.handle('plugins:getConfig', (_event, id: string, key: string) => getPluginConfig(db, id, key));
  ipcMain.handle('plugins:listConfig', (_event, id: string) => listPluginConfig(db, id));
  ipcMain.handle('plugins:setConfig', (_event, id: string, key: string, value: string) => setPluginConfig(db, id, key, value));
  ipcMain.handle('plugins:deleteConfig', (_event, id: string, key: string) => deletePluginConfig(db, id, key));
}
