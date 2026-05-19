import { useCallback, useEffect, useState } from 'react';

export interface PluginCapability {
  enabled: boolean;
  /** When false, hide unreported badges/batch actions for tasks owned by this
   *  plugin, and (server-side) skip auto-mark-reported on push. */
  tracksReported: boolean;
}

export type PluginCapabilityMap = Record<string, PluginCapability>;

const TRACKS_REPORTED_KEY = 'tracks-reported';

/**
 * Loads a `{ pluginId → { enabled, tracksReported } }` map for all installed
 * plugins. Defaults `tracksReported` to true (matches the plugin-side default
 * in `loadConfig`). Refreshes when any plugin row mutates.
 */
export function usePluginCapabilities(): PluginCapabilityMap {
  const [map, setMap] = useState<PluginCapabilityMap>({});

  const refresh = useCallback(async () => {
    try {
      const plugins = await window.api.plugins.list();
      const next: PluginCapabilityMap = {};
      await Promise.all(
        plugins.map(async (p) => {
          const raw = await window.api.plugins.getConfig(p.id, TRACKS_REPORTED_KEY);
          next[p.id] = {
            enabled: p.enabled,
            tracksReported: raw === null ? true : raw !== 'false',
          };
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
