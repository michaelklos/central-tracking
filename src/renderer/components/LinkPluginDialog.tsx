import React, { useEffect, useState } from 'react';
import type { Plugin } from '../../shared/types';
import './LinkPluginDialog.css';

export interface LinkSubmit {
  pluginId: string;
  externalId: string;
  mode: 'link' | 'mirror';
}

interface LinkPluginDialogProps {
  onCancel(): void;
  onSubmit(input: LinkSubmit): Promise<void>;
}

export function LinkPluginDialog({ onCancel, onSubmit }: LinkPluginDialogProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pluginId, setPluginId] = useState<string>('');
  const [externalId, setExternalId] = useState<string>('');
  const [mode, setMode] = useState<'link' | 'mirror'>('link');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api.plugins.list().then((list) => {
      if (cancelled) return;
      const enabledPlugins = list.filter((p) => p.enabled);
      setPlugins(enabledPlugins);
      if (enabledPlugins.length > 0) setPluginId(enabledPlugins[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = pluginId.length > 0 && externalId.trim().length > 0 && !pending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit({ pluginId, externalId: externalId.trim(), mode });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPending(false);
    }
  };

  return (
    <div className="link-dialog__overlay" onClick={onCancel}>
      <div className="link-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="link-dialog__title">Link to plugin</h3>

        {plugins.length === 0 ? (
          <p className="link-dialog__empty">
            No enabled plugins. Install or enable one in Settings → Plugins first.
          </p>
        ) : (
          <>
            <label className="link-dialog__field">
              <span>Plugin</span>
              <select value={pluginId} onChange={(e) => setPluginId(e.target.value)}>
                {plugins.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            <label className="link-dialog__field">
              <span>External ID</span>
              <input
                type="text"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="e.g. 12345"
                autoFocus
              />
            </label>

            <fieldset className="link-dialog__modes">
              <legend>Mode</legend>
              <label className="link-dialog__mode">
                <input
                  type="radio"
                  name="mode"
                  value="link"
                  checked={mode === 'link'}
                  onChange={() => setMode('link')}
                />
                <span>
                  <strong>Link only</strong> — push time/comments to the remote.
                  Title/notes stay editable; no state sync.
                </span>
              </label>
              <label className="link-dialog__mode">
                <input
                  type="radio"
                  name="mode"
                  value="mirror"
                  checked={mode === 'mirror'}
                  onChange={() => setMode('mirror')}
                />
                <span>
                  <strong>Full mirror</strong> — lock title/notes, enforce status
                  FSM, pull state on next sync.
                </span>
              </label>
            </fieldset>
          </>
        )}

        {error && <p className="link-dialog__error">{error}</p>}

        <div className="link-dialog__actions">
          <button className="link-dialog__cancel" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            className="link-dialog__submit"
            onClick={handleSubmit}
            disabled={!canSubmit || plugins.length === 0}
          >
            {pending ? 'Linking...' : 'Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
