import React, { useState, useRef, useEffect, useCallback } from 'react';
import './HelpPopover.css';

interface HelpPopoverProps {
  children: React.ReactNode;
  title?: string;
}

interface PanelStyle {
  bottom: number;
  right: number;
  maxWidth: number;
}

export function HelpPopover({ children, title }: HelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<PanelStyle | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const computeStyle = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelStyle({
      bottom: window.innerHeight - rect.top + 8,
      right: window.innerWidth - rect.right,
      maxWidth: Math.min(300, rect.right - 12),
    });
  }, []);

  const handleToggle = () => {
    if (!open) computeStyle();
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', closeOnScroll, { once: true });
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', closeOnScroll);
    };
  }, [open]);

  return (
    <div className="help-popover">
      <button
        ref={triggerRef}
        className="help-popover__trigger"
        onClick={handleToggle}
        title="Show help"
        type="button"
      >
        ?
      </button>
      {open && panelStyle && (
        <div
          ref={panelRef}
          className="help-popover__panel"
          style={{
            position: 'fixed',
            bottom: panelStyle.bottom,
            right: panelStyle.right,
            maxWidth: panelStyle.maxWidth,
          }}
        >
          {title && <div className="help-popover__title">{title}</div>}
          <div className="help-popover__content">{children}</div>
        </div>
      )}
    </div>
  );
}
