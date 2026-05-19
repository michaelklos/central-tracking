import React, { useCallback, useEffect, useState } from 'react';
import type { Plugin } from '../../shared/types';
import './PluginsSettings.css';

interface PluginRowState {
  pending: boolean;
  error: string | null;
}

const TRACKS_REPORTED_KEY = 'tracks-reported';

export function PluginsSettings() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [rowState, setRowState] = useState<Record<string, PluginRowState>>({});
  const [tracksReported, setTracksReported] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    try {
      const list = await window.api.plugins.list();
      setPlugins(list);
      const values: Record<string, boolean> = {};
      await Promise.all(
        list.map(async (p) => {
          const raw = await window.api.plugins.getConfig(p.id, TRACKS_REPORTED_KEY);
          values[p.id] = raw === null ? true : raw !== 'false';
        }),
      );
      setTracksReported(values);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = window.api.onDataChanged(refresh);
    return unsubscribe;
  }, [refresh]);

  const toggle = async (p: Plugin) => {
    const next = !p.enabled;
    setRowState((prev) => ({ ...prev, [p.id]: { pending: true, error: null } }));
    try {
      await window.api.plugins.setEnabled(p.id, next);
      await refresh();
      setRowState((prev) => ({ ...prev, [p.id]: { pending: false, error: null } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRowState((prev) => ({ ...prev, [p.id]: { pending: false, error: message } }));
    }
  };

  const toggleTracksReported = async (p: Plugin) => {
    const next = !(tracksReported[p.id] ?? true);
    setTracksReported((prev) => ({ ...prev, [p.id]: next }));
    try {
      await window.api.plugins.setConfig(p.id, TRACKS_REPORTED_KEY, String(next));
    } catch (err) {
      // Revert optimistic toggle on failure.
      setTracksReported((prev) => ({ ...prev, [p.id]: !next }));
      const message = err instanceof Error ? err.message : String(err);
      setRowState((prev) => ({ ...prev, [p.id]: { pending: false, error: message } }));
    }
  };

  if (!loaded) return null;

  if (plugins.length === 0) {
    return (
      <p className="plugins-settings__empty">
        No plugins installed. Use <code>ct plugin install &lt;manifest.json&gt;</code> to add one.
      </p>
    );
  }

  return (
    <ul className="plugins-settings__list">
      {plugins.map((p) => {
        const state = rowState[p.id];
        return (
          <li key={p.id} className="plugins-settings__row">
            <div className="plugins-settings__row-header">
              <label className="plugins-settings__toggle">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  disabled={state?.pending}
                  onChange={() => toggle(p)}
                />
                <span className="plugins-settings__name">{p.name}</span>
                <span className="plugins-settings__version">v{p.version}</span>
              </label>
            </div>
            <div className="plugins-settings__subrow">
              <label title="When off, hide unreported badges/batch actions and skip auto-mark-as-reported on push">
                <input
                  type="checkbox"
                  checked={tracksReported[p.id] ?? true}
                  onChange={() => toggleTracksReported(p)}
                />
                <span>Track reported time</span>
              </label>
            </div>
            {state?.error && (
              <p className="plugins-settings__error">{state.error}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
