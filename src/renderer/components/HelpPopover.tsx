import React, { useState, useRef, useEffect } from 'react';
import './HelpPopover.css';

interface HelpPopoverProps {
  children: React.ReactNode;
  title?: string;
}

export function HelpPopover({ children, title }: HelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="help-popover" ref={ref}>
      <button
        className="help-popover__trigger"
        onClick={() => setOpen((v) => !v)}
        title="Show format help"
        type="button"
      >
        ?
      </button>
      {open && (
        <div className="help-popover__panel">
          {title && <div className="help-popover__title">{title}</div>}
          <div className="help-popover__content">{children}</div>
        </div>
      )}
    </div>
  );
}
