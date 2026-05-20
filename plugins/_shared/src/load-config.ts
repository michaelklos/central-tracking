/**
 * Generic config loader. Plugins call this with their list of required keys
 * and a `parse` function that turns the raw {key: value} map into the
 * plugin's typed config shape.
 *
 * The required-key gate fires here so each plugin doesn't re-implement the
 * "missing keys — set via ct plugin config set …" error message.
 */
import { CtClient } from './ct-client';
import type { PluginConfigEntry } from './types';

function toMap(entries: PluginConfigEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) out[e.key] = e.value;
  return out;
}

export async function loadConfig<T>(
  client: CtClient,
  requiredKeys: readonly string[],
  parse: (map: Record<string, string>) => T,
): Promise<T> {
  const entries = await client.listPluginConfig();
  const map = toMap(entries);
  const missing = requiredKeys.filter((k) => !map[k]);
  if (missing.length) {
    throw new Error(
      `Missing required ${client.pluginId} config keys: ${missing.join(', ')}. ` +
        `Set via: ct plugin config set ${client.pluginId} <key> <value>`,
    );
  }
  return parse(map);
}
