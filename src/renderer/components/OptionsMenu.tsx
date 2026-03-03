import React, { useState } from 'react';
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

export function OptionsMenu() {
  const [values, setValues] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const opt of OPTIONS) {
      initial[opt.key] = getOption(opt.key, opt.defaultValue);
    }
    return initial;
  });

  const toggleOption = (key: string) => {
    const newValue = !values[key];
    setValues({ ...values, [key]: newValue });
    localStorage.setItem(key, String(newValue));
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
    </div>
  );
}
