import React, { useRef, useEffect, useState } from 'react';
import './MultiSelectDropdown.css';

export interface MultiSelectOption {
  value: string;
  label: string;
  color?: string;
}

interface Props {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange(selected: string[]): void;
}

export function MultiSelectDropdown({ label, options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const allSelected = options.length > 0 && selected.length === options.length;
  const noneSelected = selected.length === 0;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !noneSelected && !allSelected;
    }
  }, [selected, allSelected, noneSelected]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    );
  };

  const handleSelectAll = () => {
    onChange(allSelected ? [] : options.map((o) => o.value));
  };

  const triggerLabel = noneSelected ? label : `${selected.length} selected`;

  return (
    <div className={`msd ${open ? 'msd--open' : ''}`} ref={containerRef}>
      <div className={`msd__trigger ${!noneSelected ? 'msd__trigger--active' : ''}`}>
        <button
          className="msd__trigger-btn"
          onClick={() => setOpen((o) => !o)}
          type="button"
        >
          <span className="msd__trigger-label">{triggerLabel}</span>
          <span className="msd__chevron">{open ? '▴' : '▾'}</span>
        </button>
        {!noneSelected && (
          <button
            className="msd__clear"
            onClick={(e) => { e.stopPropagation(); onChange([]); setOpen(false); }}
            title={`Clear ${label} filter`}
            type="button"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="msd__panel">
          <label className="msd__option msd__option--all">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={handleSelectAll}
            />
            <span>Select all</span>
          </label>
          <div className="msd__divider" />
          {options.map((opt) => (
            <label key={opt.value} className="msd__option">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              {opt.color && (
                <span className="msd__color-dot" style={{ background: opt.color }} />
              )}
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
