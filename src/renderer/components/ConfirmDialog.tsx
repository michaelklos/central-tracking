import React, { useState } from 'react';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  /** When set, user must type this exact string before confirming. */
  confirmPhrase?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  confirmPhrase,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [phraseInput, setPhraseInput] = useState('');
  const canConfirm = !confirmPhrase || phraseInput === confirmPhrase;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-dialog__title">{title}</h2>
        <p className="confirm-dialog__message">{message}</p>
        {confirmPhrase && (
          <div className="confirm-dialog__phrase">
            <label className="confirm-dialog__phrase-label">
              Type <strong>{confirmPhrase}</strong> to confirm
            </label>
            <input
              className="confirm-dialog__phrase-input"
              type="text"
              value={phraseInput}
              onChange={(e) => setPhraseInput(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        <div className="confirm-dialog__actions">
          <button className="confirm-dialog__cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`confirm-dialog__confirm ${variant === 'danger' ? 'confirm-dialog__confirm--danger' : ''}`}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
