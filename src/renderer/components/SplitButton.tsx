import React, { useState, useRef, useEffect } from 'react';
import './SplitButton.css';

interface SplitButtonProps {
  primaryLabel: string;
  primaryAction: () => void;
  alternatives: { label: string; action: () => void }[];
}

export function SplitButton({ primaryLabel, primaryAction, alternatives }: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="split-button" ref={ref}>
      <button className="split-button__primary" onClick={primaryAction}>
        {primaryLabel}
      </button>
      <button
        className="split-button__arrow"
        onClick={() => setOpen(!open)}
        title="More options"
      >
        &#9662;
      </button>
      {open && (
        <div className="split-button__dropdown">
          {alternatives.map((alt) => (
            <button
              key={alt.label}
              className="split-button__option"
              onClick={() => {
                alt.action();
                setOpen(false);
              }}
            >
              {alt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
