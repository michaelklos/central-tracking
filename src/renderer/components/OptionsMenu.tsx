import React, { useState, useEffect } from 'react';
import './OptionsMenu.css';

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

const isMac = window.api.platform === 'darwin';

export function OptionsMenu() {
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [cliPending, setCliPending] = useState(false);

  useEffect(() => {
    if (!isMac) return;
    window.api.cli.isInstalled().then(setCliInstalled);
  }, []);

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
    const newValue = !values[key];
    setValues({ ...values, [key]: newValue });
    localStorage.setItem(key, String(newValue));
  };

  const updateGeneralSetting = (key: string, value: string) => {
    setGeneralValues({ ...generalValues, [key]: value });
    localStorage.setItem(key, value);
  };

  const updateTimelineSetting = (key: string, value: string) => {
    setTimelineValues({ ...timelineValues, [key]: value });
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

      {isMac && cliInstalled !== null && (
        <>
          <h3 className="options-menu__title options-menu__title--section">CLI</h3>
          <div className="options-menu__list">
            <label className="options-menu__item">
              <input
                type="checkbox"
                checked={cliInstalled}
                onChange={toggleCli}
                disabled={cliPending}
              />
              <span>Enable <code>ct</code> command-line tool</span>
            </label>
            {cliError && (
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
    </div>
  );
}
