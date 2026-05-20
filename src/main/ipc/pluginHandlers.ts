import type { IpcMain } from 'electron';
import type { Database } from '../database/database';
import type {
  Plugin,
  PluginManifest,
  PluginConfigEntry,
  PluginConfigSchemaEntry,
} from '../../shared/types';
import * as secretStorage from '../secretStorage';
import { DomainError } from '../errors';

interface PluginRow {
  id: string;
  name: string;
  version: string;
  enabled: number;
  manifest: string;
  installed_at: string;
  source: string;
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
    source: row.source === 'bundled' ? 'bundled' : 'sideloaded',
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
  if (m.entrypointArgv !== undefined) {
    if (!Array.isArray(m.entrypointArgv) || m.entrypointArgv.length === 0) {
      throw new Error('Plugin manifest "entrypointArgv" must be a non-empty array');
    }
    if (m.entrypointArgv.some((t) => typeof t !== 'string')) {
      throw new Error('Plugin manifest "entrypointArgv" must be an array of strings');
    }
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
  if (m.env !== undefined) {
    if (!m.env || typeof m.env !== 'object' || Array.isArray(m.env)) {
      throw new Error('Plugin manifest "env" must be an object');
    }
    for (const [k, v] of Object.entries(m.env as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        throw new Error(`Plugin manifest env["${k}"] must be a string`);
      }
    }
  }
  if (m.configSchema !== undefined) {
    if (!m.configSchema || typeof m.configSchema !== 'object' || Array.isArray(m.configSchema)) {
      throw new Error('Plugin manifest "configSchema" must be an object');
    }
    for (const [k, spec] of Object.entries(m.configSchema as Record<string, unknown>)) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(k)) {
        throw new Error(`Plugin manifest configSchema key "${k}" must match [a-z0-9._-]`);
      }
      if (!spec || typeof spec !== 'object') {
        throw new Error(`Plugin manifest configSchema["${k}"] must be an object`);
      }
      const s = spec as Record<string, unknown>;
      if (typeof s.required !== 'boolean') {
        throw new Error(`Plugin manifest configSchema["${k}"].required must be boolean`);
      }
      if (typeof s.secret !== 'boolean') {
        throw new Error(`Plugin manifest configSchema["${k}"].secret must be boolean`);
      }
      if (s.description !== undefined && typeof s.description !== 'string') {
        throw new Error(`Plugin manifest configSchema["${k}"].description must be a string when present`);
      }
    }
  }
  return m as unknown as PluginManifest;
}

export function installPlugin(db: Database, manifestInput: unknown): Plugin {
  const manifest = validatePluginManifest(manifestInput);
  const now = new Date().toISOString();

  const existing = db.instance.prepare('SELECT id FROM plugins WHERE id = ?').get(manifest.id) as { id: string } | undefined;
  if (existing) {
    // Leave source untouched on update — sideloaded stays sideloaded, bundled stays bundled.
    db.instance
      .prepare('UPDATE plugins SET name = ?, version = ?, manifest = ? WHERE id = ?')
      .run(manifest.name, manifest.version, JSON.stringify(manifest), manifest.id);
  } else {
    db.instance
      .prepare(
        `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
         VALUES (?, ?, ?, 1, ?, ?, 'sideloaded')`,
      )
      .run(manifest.id, manifest.name, manifest.version, JSON.stringify(manifest), now);
  }
  return getPlugin(db, manifest.id) as Plugin;
}

/**
 * Auto-register a plugin shipped inside the app bundle. Differs from
 * `installPlugin`:
 *   - INSERT defaults to `enabled = 0` (available-but-disabled).
 *   - `source = 'bundled'` is set so `uninstallPlugin` will refuse.
 *   - UPDATE only fires on version change, never touches `enabled` or
 *     `source` (preserves the user's enable/disable choice across upgrades).
 * Same-version reruns are intentional no-ops.
 */
export function registerBundledPlugin(db: Database, manifestInput: unknown): Plugin {
  const manifest = validatePluginManifest(manifestInput);
  const now = new Date().toISOString();
  const existing = db.instance
    .prepare('SELECT version FROM plugins WHERE id = ?')
    .get(manifest.id) as { version: string } | undefined;

  if (!existing) {
    db.instance
      .prepare(
        `INSERT INTO plugins (id, name, version, enabled, manifest, installed_at, source)
         VALUES (?, ?, ?, 0, ?, ?, 'bundled')`,
      )
      .run(manifest.id, manifest.name, manifest.version, JSON.stringify(manifest), now);
  } else if (existing.version !== manifest.version) {
    db.instance
      .prepare('UPDATE plugins SET name = ?, version = ?, manifest = ? WHERE id = ?')
      .run(manifest.name, manifest.version, JSON.stringify(manifest), manifest.id);
  }
  return getPlugin(db, manifest.id) as Plugin;
}

export function uninstallPlugin(db: Database, id: string): void {
  const row = db.instance.prepare('SELECT source FROM plugins WHERE id = ?').get(id) as
    | { source: string }
    | undefined;
  if (row?.source === 'bundled') {
    throw new DomainError(
      'BUNDLED_PLUGIN_LOCKED',
      `Bundled plugins can't be uninstalled. Disable instead with \`ct plugin disable ${id}\`.`,
    );
  }
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

import {
  PLUGIN_SECRET_MASK_ENCRYPTED,
  PLUGIN_SECRET_MASK_PLAINTEXT,
} from '../../shared/types';

/** Pulled out so the IPC bridge and HTTP route mask identically. */
export function maskSecretValue(stored: 'encrypted' | 'plaintext'): string {
  return stored === 'encrypted' ? PLUGIN_SECRET_MASK_ENCRYPTED : PLUGIN_SECRET_MASK_PLAINTEXT;
}

function getManifestConfigSchema(db: Database, pluginId: string): Record<string, { required: boolean; secret: boolean; description?: string }> {
  const plugin = getPlugin(db, pluginId);
  return plugin?.manifest.configSchema ?? {};
}

function envVarNameFor(pluginId: string, key: string): string {
  return `CT_PLUGIN_${pluginId.toUpperCase().replace(/-/g, '_')}_${key.toUpperCase().replace(/-/g, '_')}`;
}

/**
 * Read a single config value as cleartext. Returns null if unset.
 * The IPC/HTTP boundary is responsible for masking secret values for callers
 * that haven't asked to reveal.
 */
export function getPluginConfig(db: Database, pluginId: string, key: string): string | null {
  const row = db.instance
    .prepare('SELECT value FROM plugin_config WHERE plugin_id = ? AND key = ?')
    .get(pluginId, key) as { value: string } | undefined;
  if (!row) return null;
  return secretStorage.decrypt(row.value);
}

export interface SetPluginConfigOptions {
  /** Force-treat as secret even when the manifest doesn't declare it. */
  secret?: boolean;
  /** Allow plaintext storage when the OS keyring is unavailable. */
  allowPlaintext?: boolean;
}

export interface SetPluginConfigResult {
  stored: 'encrypted' | 'plaintext';
  /** Set when the value was stored as plaintext despite being a secret. */
  warning?: string;
}

/**
 * Upsert a config value. When the key is marked secret (manifest OR caller
 * opt-in), the value is encrypted via `safeStorage`. If the keyring is
 * unavailable, `allowPlaintext` lets the caller proceed with a warning; the
 * default is to throw `DomainError('NO_KEYRING', …)` so the user notices.
 */
export function setPluginConfig(
  db: Database,
  pluginId: string,
  key: string,
  value: string,
  opts: SetPluginConfigOptions = {},
): SetPluginConfigResult {
  const schema = getManifestConfigSchema(db, pluginId);
  const declaredSecret = schema[key]?.secret ?? false;
  const treatAsSecret = opts.secret ?? declaredSecret;

  let stored: 'encrypted' | 'plaintext' = 'plaintext';
  let written = value;
  let warning: string | undefined;

  if (treatAsSecret) {
    if (secretStorage.isAvailable()) {
      written = secretStorage.encrypt(value);
      stored = 'encrypted';
    } else if (opts.allowPlaintext) {
      warning =
        'OS keyring unavailable; value stored as PLAINTEXT. ' +
        'Install gnome-keyring/libsecret (GNOME) or kwallet (KDE) to enable encryption.';
      // stored stays 'plaintext'
    } else {
      // Re-uses secretStorage's own error message + remediation.
      secretStorage.encrypt(value); // throws DomainError('NO_KEYRING', …)
    }
  }

  db.instance
    .prepare(
      `INSERT INTO plugin_config (plugin_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(pluginId, key, written);

  return warning ? { stored, warning } : { stored };
}

export function deletePluginConfig(db: Database, pluginId: string, key: string): void {
  db.instance.prepare('DELETE FROM plugin_config WHERE plugin_id = ? AND key = ?').run(pluginId, key);
}

/**
 * Returns every persisted config entry for a plugin with cleartext values
 * and metadata. The IPC/HTTP boundary masks `value` when the caller hasn't
 * asked to reveal.
 */
export function listPluginConfig(db: Database, pluginId: string): PluginConfigEntry[] {
  const schema = getManifestConfigSchema(db, pluginId);
  const rows = db.instance
    .prepare('SELECT plugin_id, key, value FROM plugin_config WHERE plugin_id = ? ORDER BY key ASC')
    .all(pluginId) as Array<{ plugin_id: string; key: string; value: string }>;
  return rows.map((r) => {
    const stored: 'encrypted' | 'plaintext' = secretStorage.isEncrypted(r.value) ? 'encrypted' : 'plaintext';
    const secret = schema[r.key]?.secret ?? stored === 'encrypted';
    return {
      pluginId: r.plugin_id,
      key: r.key,
      value: secretStorage.decrypt(r.value),
      secret,
      stored,
    };
  });
}

/**
 * Merged view of the plugin's declared `configSchema` + actual DB state.
 * Drives `ct plugin schema <id>` and the required-key gating in `plugin run`.
 * Keys present in the DB but not declared in the schema are also included
 * (so the user can still see what's there), with required=false, secret
 * derived from storage shape.
 */
export function getPluginConfigSchema(db: Database, pluginId: string): PluginConfigSchemaEntry[] {
  const schema = getManifestConfigSchema(db, pluginId);
  const rows = db.instance
    .prepare('SELECT key, value FROM plugin_config WHERE plugin_id = ?')
    .all(pluginId) as Array<{ key: string; value: string }>;
  const rowMap = new Map(rows.map((r) => [r.key, r.value]));

  // Start with manifest-declared keys (preserve declaration order).
  const seen = new Set<string>();
  const out: PluginConfigSchemaEntry[] = [];
  for (const [key, spec] of Object.entries(schema)) {
    seen.add(key);
    const raw = rowMap.get(key);
    let status: PluginConfigSchemaEntry['status'];
    if (raw === undefined) {
      status = 'unset';
    } else if (secretStorage.isEncrypted(raw)) {
      status = 'encrypted';
    } else if (spec.secret) {
      status = 'plaintext-secret';
    } else {
      status = 'set';
    }
    out.push({
      key,
      required: spec.required,
      secret: spec.secret,
      description: spec.description,
      status,
      envVarName: spec.secret ? envVarNameFor(pluginId, key) : null,
    });
  }
  // Append any extra DB keys not declared in the manifest.
  for (const [key, raw] of rowMap.entries()) {
    if (seen.has(key)) continue;
    const encrypted = secretStorage.isEncrypted(raw);
    out.push({
      key,
      required: false,
      secret: encrypted,
      status: encrypted ? 'encrypted' : 'set',
      envVarName: null,
    });
  }
  return out;
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

  // Renderer-bound config reads are ALWAYS masked. There's no opts/reveal
  // parameter on this IPC bridge — masking is enforced by the absence of an
  // option to flip it off. Plugins/CLI that need cleartext go via the HTTP
  // route in apiManifest and pass reveal:true explicitly.
  ipcMain.handle('plugins:getConfig', (_event, id: string, key: string) => {
    const value = getPluginConfig(db, id, key);
    if (value === null) return null;
    const schema = getPluginConfigSchema(db, id).find((s) => s.key === key);
    if (!schema?.secret) return value;
    return maskSecretValue(schema.status === 'plaintext-secret' ? 'plaintext' : 'encrypted');
  });
  ipcMain.handle('plugins:listConfig', (_event, id: string) => {
    return listPluginConfig(db, id).map((e) =>
      e.secret ? { ...e, value: maskSecretValue(e.stored) } : e,
    );
  });

  ipcMain.handle('plugins:setConfig', (_event, id: string, key: string, value: string, opts?: SetPluginConfigOptions) =>
    setPluginConfig(db, id, key, value, opts ?? {}),
  );
  ipcMain.handle('plugins:deleteConfig', (_event, id: string, key: string) => deletePluginConfig(db, id, key));
  ipcMain.handle('plugins:schema', (_event, id: string) => getPluginConfigSchema(db, id));
}

/**
 * Mask values in a PluginConfigEntry[] in place of cleartext. Used by HTTP
 * route handlers when the caller did NOT pass reveal:true.
 */
export function maskListEntries(entries: PluginConfigEntry[]): PluginConfigEntry[] {
  return entries.map((e) =>
    e.secret ? { ...e, value: maskSecretValue(e.stored) } : e,
  );
}
