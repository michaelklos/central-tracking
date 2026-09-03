import { useCallback, useEffect, useState } from 'react';

export interface PluginCapability {
  enabled: boolean;
  /** When false, hide unreported badges/batch actions for tasks owned by this
   *  plugin, and (server-side) skip auto-mark-reported on push. */
  tracksReported: boolean;
}

export type PluginCapabilityMap = Record<string, PluginCapability>;

/**
 * Config key that overrides the manifest's `capabilities.tracksReported`
 * default. Kept here (renderer-only) because it's the renderer reading the
 * override; the host doesn't care which name plugins use.
 */
export const TRACKS_REPORTED_CONFIG_KEY = 'tracks-reported';

/**
 * The one precedence rule for `tracksReported`: user-set config key >
 * manifest capability default > historical default (true).
 *
 * Exported because the plugins settings page renders the same flag as a
 * toggle. It used to resolve it on its own, ignoring the manifest, so a
 * plugin declaring `tracksReported: false` would show its toggle on while
 * the task list hid the badges. The two agreed only because the ADO manifest
 * happens to declare `true`.
 *
 * `manifestValue` is the manifest's capabilities map verbatim, so anything
 * other than a boolean (missing, or a plugin writing a string) falls through
 * to the historical default. `override` is the raw config string, or null
 * when the user has never set it.
 */
export function resolveTracksReported(manifestValue: unknown, override: string | null): boolean {
  const manifestDefault = typeof manifestValue === 'boolean' ? manifestValue : true;
  return override === null ? manifestDefault : override !== 'false';
}

/**
 * Loads a `{ pluginId → { enabled, tracksReported } }` map for all installed
 * plugins. Precedence: user-set config key > manifest capability default >
 * historical default (true).
 *
 * Refreshes when any plugin row mutates.
 */
export function usePluginCapabilities(): PluginCapabilityMap {
  const [map, setMap] = useState<PluginCapabilityMap>({});

  const refresh = useCallback(async () => {
    try {
      const caps = await window.api.plugins.getCapabilities();
      // Per-plugin config-key override is still honoured (user opt-out
      // sticks even after manifest defaults change). One getConfig call
      // per plugin is acceptable because the override is rare; the
      // capabilities call eliminates the N-key fan-out for the default.
      const next: PluginCapabilityMap = {};
      await Promise.all(
        caps.map(async (c) => {
          const override = await window.api.plugins.getConfig(c.id, TRACKS_REPORTED_CONFIG_KEY);
          const tracksReported = resolveTracksReported(c.capabilities?.tracksReported, override);
          next[c.id] = { enabled: c.enabled, tracksReported };
        }),
      );
      setMap(next);
    } catch {
      // Surface a stale-but-non-empty map rather than blowing up the UI on a
      // transient HTTP/IPC error.
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = window.api.onDataChanged(refresh);
    return unsubscribe;
  }, [refresh]);

  return map;
}

/** Returns true when the given pluginId either is null (no plugin) or has
 *  tracksReported on. Used to gate unreported indicators on a task. */
export function shouldShowReportedFor(
  pluginId: string | null,
  caps: PluginCapabilityMap,
): boolean {
  if (!pluginId) return true;
  const cap = caps[pluginId];
  if (!cap) return true;
  return cap.tracksReported;
}
