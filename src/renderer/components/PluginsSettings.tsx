import React, { useCallback, useEffect, useState } from 'react';
import type { Plugin } from '../../shared/types';
import { HelpPopover } from './HelpPopover';
import './PluginsSettings.css';

function AdoHelp() {
  return (
    <>
      <p>The ADO plugin runs from the <code>ct</code> CLI. Open a terminal and:</p>
      <p><strong>1. Configure (one-time):</strong></p>
      <pre>{`ct plugin schema ado
ct plugin config set ado organization <org-slug>
ct plugin config set ado project      <project-name>
echo "$ADO_PAT" | ct plugin config set ado pat --secret-from-stdin`}</pre>
      <p>PAT scope: <code>Work Items: Read &amp; write</code> (or just <code>Read</code> for pull-only).</p>
      <p><strong>2. Sync:</strong></p>
      <pre>{`ct plugin run ado sync           # push-state → push-time → push-comments → pull
ct plugin run ado pull           # mirror current sprint into ct
ct plugin run ado push-time      # push unreported time → CompletedWork
ct plugin run ado push-state     # push status changes
ct plugin run ado push-comments  # push syncable comments`}</pre>
      <p>App must be running. UI for config + run is planned for a later release.</p>
    </>
  );
}

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
                {p.source === 'bundled' && (
                  <span
                    className="plugins-settings__badge"
                    title="Ships with the app — disable instead of uninstall."
                  >
                    bundled
                  </span>
                )}
                <span className="plugins-settings__version">v{p.version}</span>
              </label>
              {p.id === 'ado' && (
                <HelpPopover title="ADO Plugin">
                  <AdoHelp />
                </HelpPopover>
              )}
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
