import React, { useState } from 'react';
import type { TimeEntry } from '../../shared/types';
import { formatDuration } from '../utils/time';
import { validateTimeEntry } from '../utils/timeValidation';
import './TimeEntryEditor.css';

interface TimeEntryEditorProps {
  entry: TimeEntry;
  allEntries: TimeEntry[];
  onSave: (id: string, startTime: string, endTime: string, note: string) => Promise<void>;
  onCancel: () => void;
  onDelete: (id: string) => void;
}

export function TimeEntryEditor({ entry, allEntries, onSave, onCancel, onDelete }: TimeEntryEditorProps) {
  const [editing, setEditing] = useState(false);
  const [startDraft, setStartDraft] = useState(entry.startTime);
  const [endDraft, setEndDraft] = useState(entry.endTime ?? '');
  const [noteDraft, setNoteDraft] = useState(entry.note);
  const [error, setError] = useState('');

  const handleEdit = () => {
    setStartDraft(entry.startTime);
    setEndDraft(entry.endTime ?? '');
    setNoteDraft(entry.note);
    setError('');
    setEditing(true);
  };

  const handleSave = async () => {
    if (!endDraft) {
      setError('End time is required');
      return;
    }

    const validation = validateTimeEntry(startDraft, endDraft, allEntries, entry.id);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid time range');
      return;
    }

    await onSave(entry.id, startDraft, endDraft, noteDraft);
    setEditing(false);
    setError('');
  };

  const handleCancel = () => {
    setEditing(false);
    setError('');
    onCancel();
  };

  if (editing) {
    return (
      <div className="time-entry time-entry--editing">
        <div className="time-entry-editor__fields">
          <div className="time-entry-editor__row">
            <label>Start</label>
            <input
              type="datetime-local"
              value={toDatetimeLocal(startDraft)}
              onChange={(e) => setStartDraft(new Date(e.target.value).toISOString())}
            />
          </div>
          <div className="time-entry-editor__row">
            <label>End</label>
            <input
              type="datetime-local"
              value={toDatetimeLocal(endDraft)}
              onChange={(e) => setEndDraft(new Date(e.target.value).toISOString())}
            />
          </div>
          <div className="time-entry-editor__row">
            <label>Note</label>
            <input
              type="text"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Optional note..."
            />
          </div>
          {error && <div className="time-entry-editor__error">{error}</div>}
          <div className="time-entry-editor__actions">
            <button className="time-entry-editor__save" onClick={handleSave}>Save</button>
            <button className="time-entry-editor__cancel" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="time-entry">
      <div className="time-entry__info">
        <span className="time-entry__date">
          {new Date(entry.startTime).toLocaleDateString()}
        </span>
        <span className="time-entry__range">
          {new Date(entry.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {entry.endTime
            ? ` - ${new Date(entry.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : ' - running'}
        </span>
        {entry.note && <span className="time-entry__note">{entry.note}</span>}
      </div>
      <div className="time-entry__right">
        <span className="time-entry__duration">
          {entry.durationSeconds != null ? formatDuration(entry.durationSeconds) : 'active'}
        </span>
        <button className="time-entry__edit" onClick={handleEdit} title="Edit entry">
          &#9998;
        </button>
        <button className="time-entry__delete" onClick={() => onDelete(entry.id)} title="Delete entry">
          &times;
        </button>
      </div>
    </div>
  );
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
