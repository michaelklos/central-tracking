import React, { useState, useEffect } from 'react';
import { HelpPopover } from './HelpPopover';
import { ConfirmDialog } from './ConfirmDialog';
import { PluginsSettings } from './PluginsSettings';
import { useTaskContext } from '../context/TaskContext';
import './OptionsMenu.css';

const REPO_URL = 'https://github.com/michaelklos/central-tracking';

interface Option {
  key: string;
  label: string;
  defaultValue: boolean;
}

const OPTIONS: Option[] = [
  { key: 'ct-option-auto-start-timer', label: 'Auto-start timer on task creation', defaultValue: false },
  { key: 'ct-option-confirm-delete', label: 'Confirm before deleting tasks', defaultValue: true },
  { key: 'ct-option-show-seconds', label: 'Show seconds in time display', defaultValue: true },
];

function getOption(key: string, defaultValue: boolean): boolean {
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  return stored === 'true';
}

export function getStringSetting(key: string, defaultValue: string): string {
  return localStorage.getItem(key) ?? defaultValue;
}

interface StringSetting {
  key: string;
  label: string;
  type: 'time' | 'number' | 'text';
  defaultValue: string;
  min?: number;
  max?: number;
}

const GENERAL_SETTINGS: StringSetting[] = [
  { key: 'ct-option-default-duration-min', label: 'Default entry duration (min)', type: 'number', defaultValue: '30', min: 1, max: 480 },
];

const TIMELINE_SETTINGS: StringSetting[] = [
  { key: 'ct-option-work-hours-start', label: 'Work hours start', type: 'time', defaultValue: '08:00' },
  { key: 'ct-option-work-hours-end', label: 'Work hours end', type: 'time', defaultValue: '17:00' },
  { key: 'ct-option-min-gap-minutes', label: 'Min gap (minutes)', type: 'number', defaultValue: '15' },
  { key: 'ct-option-gap-label', label: 'Gap label', type: 'text', defaultValue: 'gap' },
];

export function OptionsMenu() {
  const isMac = window.api?.platform === 'darwin';
  const { categories, createCategory, updateCategory, deleteCategory, resetApp } = useTaskContext();
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');
  const [resetConfirm, setResetConfirm] = useState(false);

  const handleCreateCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    await createCategory({ name, color: newCatColor });
    setNewCatName('');
  };
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [cliPending, setCliPending] = useState(false);

  useEffect(() => {
    if (!isMac) return;
    window.api.cli.isInstalled().then(setCliInstalled);
  }, [isMac]);

  const toggleCli = async () => {
    if (cliInstalled === null || cliPending) return;
    setCliPending(true);
    setCliError(null);
    const result = cliInstalled
      ? await window.api.cli.uninstall()
      : await window.api.cli.install();
    if (result.ok) {
      setCliInstalled(!cliInstalled);
    } else {
      setCliError(result.error ?? 'Unknown error');
    }
    setCliPending(false);
  };

  const [values, setValues] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const opt of OPTIONS) {
      initial[opt.key] = getOption(opt.key, opt.defaultValue);
    }
    return initial;
  });

  const [generalValues, setGeneralValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const s of GENERAL_SETTINGS) {
      initial[s.key] = getStringSetting(s.key, s.defaultValue);
    }
    return initial;
  });

  const [timelineValues, setTimelineValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const s of TIMELINE_SETTINGS) {
      initial[s.key] = getStringSetting(s.key, s.defaultValue);
    }
    return initial;
  });

  const toggleOption = (key: string) => {
    setValues((prev) => {
      const newValue = !prev[key];
      localStorage.setItem(key, String(newValue));
      return { ...prev, [key]: newValue };
    });
  };

  const updateGeneralSetting = (key: string, value: string) => {
    setGeneralValues((prev) => ({ ...prev, [key]: value }));
    localStorage.setItem(key, value);
  };

  const updateTimelineSetting = (key: string, value: string) => {
    setTimelineValues((prev) => ({ ...prev, [key]: value }));
    localStorage.setItem(key, value);
  };

  return (
    <div className="options-menu">
      <h3 className="options-menu__title">Settings</h3>
      <div className="options-menu__list">
        {OPTIONS.map((opt) => (
          <label key={opt.key} className="options-menu__item">
            <input
              type="checkbox"
              checked={values[opt.key]}
              onChange={() => toggleOption(opt.key)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>

      <h3 className="options-menu__title options-menu__title--section">General</h3>
      <div className="options-menu__list">
        {GENERAL_SETTINGS.map((setting) => (
          <label key={setting.key} className="options-menu__field">
            <span className="options-menu__field-label">{setting.label}</span>
            <input
              type={setting.type}
              value={generalValues[setting.key]}
              onChange={(e) => updateGeneralSetting(setting.key, e.target.value)}
              className="options-menu__field-input"
              {...(setting.type === 'number' ? { min: setting.min ?? 1, max: setting.max ?? 999 } : {})}
            />
          </label>
        ))}
      </div>

      {(isMac ? cliInstalled !== null : true) && (
        <>
          <h3 className="options-menu__title options-menu__title--section">CLI</h3>
          <div className="options-menu__list">
            <div className="options-menu__item-row">
              {isMac ? (
                <label className="options-menu__item">
                  <input
                    type="checkbox"
                    checked={cliInstalled ?? false}
                    onChange={toggleCli}
                    disabled={cliPending}
                  />
                  <span>Enable <code>ct</code> command-line tool</span>
                </label>
              ) : (
                <span className="options-menu__item options-menu__cli-info">
                  The <code>ct</code> command-line tool ships with the app.
                </span>
              )}
              <HelpPopover title="ct CLI Tool">
                <p>Controls Central Tracking from any terminal — useful for scripting, automation, and AI agents.</p>
                <pre>{`ct task list
ct task create "My task" --status in-progress
ct timer start <id>
ct report summary --from 2024-01-01 --to 2024-01-31`}</pre>
                <p>Get help for any command:</p>
                <pre>{`ct --help
ct task --help`}</pre>
                <p>Open a new terminal window if <code>ct</code> isn't recognized.</p>
              </HelpPopover>
            </div>
            {isMac && cliError && (
              <p className="options-menu__cli-error">{cliError}</p>
            )}
          </div>
        </>
      )}

      <h3 className="options-menu__title options-menu__title--section">Timeline</h3>
      <div className="options-menu__list">
        {TIMELINE_SETTINGS.map((setting) => (
          <label key={setting.key} className="options-menu__field">
            <span className="options-menu__field-label">{setting.label}</span>
            <input
              type={setting.type}
              value={timelineValues[setting.key]}
              onChange={(e) => updateTimelineSetting(setting.key, e.target.value)}
              className="options-menu__field-input"
              {...(setting.type === 'number' ? { min: 1, max: 120 } : {})}
            />
          </label>
        ))}
      </div>
      <h3 className="options-menu__title options-menu__title--section">Plugins</h3>
      <div className="options-menu__list">
        <PluginsSettings />
      </div>

      <h3 className="options-menu__title options-menu__title--section">Categories</h3>
      <div className="options-menu__list">
        <ul className="options-menu__cat-list">
          {categories.map((cat) => (
            <li key={cat.id} className="options-menu__cat-item">
              <input
                type="color"
                value={cat.color}
                onChange={(e) => updateCategory(cat.id, { color: e.target.value })}
                className="options-menu__cat-color"
                title="Change color"
              />
              <span className="options-menu__cat-name">{cat.name}</span>
              <button
                className="options-menu__cat-delete"
                onClick={() => deleteCategory(cat.id)}
                title="Delete category"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
        <div className="options-menu__cat-form">
          <input
            type="text"
            placeholder="New category..."
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
          />
          <input
            type="color"
            value={newCatColor}
            onChange={(e) => setNewCatColor(e.target.value)}
            className="options-menu__cat-color"
          />
          <button className="options-menu__cat-add" onClick={handleCreateCategory}>+</button>
        </div>
      </div>

      <h3 className="options-menu__title options-menu__title--section options-menu__title--danger">Danger Zone</h3>
      <div className="options-menu__list">
        <button className="options-menu__reset-btn" onClick={() => setResetConfirm(true)}>
          Reset App
        </button>
        <p className="options-menu__reset-desc">Permanently deletes all tasks, time entries, comments, and categories.</p>
      </div>

      {resetConfirm && (
        <ConfirmDialog
          title="Reset App"
          message="This will permanently delete all tasks, time entries, comments, and categories. This cannot be undone."
          confirmLabel="Reset"
          variant="danger"
          confirmPhrase="RESET"
          onConfirm={async () => { setResetConfirm(false); await resetApp(); }}
          onCancel={() => setResetConfirm(false)}
        />
      )}

      <div className="options-menu__source">
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); window.api.shell.openExternal(REPO_URL); }}
        >
          Central Tracking on GitHub
        </a>
      </div>
    </div>
  );
}
