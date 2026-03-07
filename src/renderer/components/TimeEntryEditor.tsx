import React, { useState, useEffect } from 'react';
import type { TimeEntry } from '../../shared/types';
import { formatDuration } from '../utils/time';
import { parseDuration, formatDurationHuman } from '../utils/duration';
import { validateTimeEntry } from '../utils/timeValidation';
import './TimeEntryEditor.css';

interface TimeEntryEditorBaseProps {
  allEntries: TimeEntry[];
  onDelete?: (id: string) => void;
  onNavigateToTimeline?: (date: string) => void;
}

interface EditModeProps extends TimeEntryEditorBaseProps {
  mode?: 'edit';
  entry: TimeEntry;
  onSave: (id: string, startTime: string, endTime: string, note: string) => Promise<void>;
  onCancel: () => void;
  onCreate?: never;
  defaultStartTime?: never;
  defaultDurationSeconds?: never;
}

interface CreateModeProps extends TimeEntryEditorBaseProps {
  mode: 'create';
  entry?: never;
  onSave?: never;
  onCancel?: never;
  onCreate: (startTime: string, endTime: string, note: string) => Promise<void>;
  defaultStartTime: string;
  defaultDurationSeconds: number;
}

type TimeEntryEditorProps = EditModeProps | CreateModeProps;

function toDateValue(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeValue(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combineDateTimeToISO(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString();
}

function computeEndTime(startIso: string, durationSeconds: number): string {
  const start = new Date(startIso).getTime();
  return new Date(start + durationSeconds * 1000).toISOString();
}

function computeDurationSeconds(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
}

export function TimeEntryEditor(props: TimeEntryEditorProps) {
  const isCreate = props.mode === 'create';

  const [editing, setEditing] = useState(isCreate);

  // Draft state for editing
  const [dateDraft, setDateDraft] = useState(() =>
    isCreate ? toDateValue(props.defaultStartTime) : ''
  );
  const [timeDraft, setTimeDraft] = useState(() =>
    isCreate ? toTimeValue(props.defaultStartTime) : ''
  );
  const [durationDraft, setDurationDraft] = useState(() =>
    isCreate ? formatDurationHuman(props.defaultDurationSeconds) : ''
  );
  const [noteDraft, setNoteDraft] = useState('');
  const [error, setError] = useState('');

  // Reset create form defaults when they change
  useEffect(() => {
    if (isCreate) {
      setDateDraft(toDateValue(props.defaultStartTime));
      setTimeDraft(toTimeValue(props.defaultStartTime));
      setDurationDraft(formatDurationHuman(props.defaultDurationSeconds));
    }
  }, [isCreate, isCreate ? props.defaultStartTime : null, isCreate ? props.defaultDurationSeconds : null]);

  const handleEdit = () => {
    if (isCreate) return;
    const entry = props.entry;
    setDateDraft(toDateValue(entry.startTime));
    setTimeDraft(toTimeValue(entry.startTime));
    if (entry.endTime) {
      const durSecs = computeDurationSeconds(entry.startTime, entry.endTime);
      setDurationDraft(formatDurationHuman(durSecs));
    } else {
      setDurationDraft('');
    }
    setNoteDraft(entry.note);
    setError('');
    setEditing(true);
  };

  const handleSubmit = async () => {
    const durSeconds = parseDuration(durationDraft);
    if (durSeconds === null || durSeconds <= 0) {
      setError('Invalid duration. Use formats like "30m", "1h30m", "1:30", or "90".');
      return;
    }

    if (!dateDraft || !timeDraft) {
      setError('Date and start time are required');
      return;
    }

    const startIso = combineDateTimeToISO(dateDraft, timeDraft);
    const endIso = computeEndTime(startIso, durSeconds);

    const validation = validateTimeEntry(
      startIso,
      endIso,
      props.allEntries,
      isCreate ? undefined : props.entry.id
    );
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid time range');
      return;
    }

    if (isCreate) {
      await props.onCreate(startIso, endIso, noteDraft);
      // Reset form
      setNoteDraft('');
      setError('');
    } else {
      await props.onSave(props.entry.id, startIso, endIso, noteDraft);
      setEditing(false);
      setError('');
    }
  };

  const handleCancel = () => {
    if (isCreate) {
      setError('');
      return;
    }
    setEditing(false);
    setError('');
    props.onCancel();
  };

  // Computed end time for display in edit form
  const computedEndDisplay = (() => {
    const durSeconds = parseDuration(durationDraft);
    if (!dateDraft || !timeDraft || durSeconds === null || durSeconds <= 0) return '';
    try {
      const startIso = combineDateTimeToISO(dateDraft, timeDraft);
      const endIso = computeEndTime(startIso, durSeconds);
      return new Date(endIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  })();

  if (editing) {
    return (
      <div className={`time-entry time-entry--editing ${isCreate ? 'time-entry--create' : ''}`}>
        {isCreate && <div className="time-entry-editor__header">Add Entry</div>}
        <div className="time-entry-editor__fields">
          <div className="time-entry-editor__datetime-row">
            <div className="time-entry-editor__row">
              <label>Date</label>
              <input
                type="date"
                value={dateDraft}
                onChange={(e) => setDateDraft(e.target.value)}
                data-testid="entry-date"
              />
            </div>
            <div className="time-entry-editor__row">
              <label>Start</label>
              <input
                type="time"
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
                data-testid="entry-start-time"
              />
            </div>
          </div>
          <div className="time-entry-editor__datetime-row">
            <div className="time-entry-editor__row">
              <label>Duration</label>
              <input
                type="text"
                value={durationDraft}
                onChange={(e) => setDurationDraft(e.target.value)}
                placeholder='e.g. "30m", "1h30m", "1:30"'
                data-testid="entry-duration"
              />
            </div>
            <div className="time-entry-editor__row">
              <label>End</label>
              <span className="time-entry-editor__end-display" data-testid="entry-end-time">
                {computedEndDisplay || '—'}
              </span>
            </div>
          </div>
          <div className="time-entry-editor__row">
            <label>Note</label>
            <input
              type="text"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Optional note..."
              data-testid="entry-note"
            />
          </div>
          {error && <div className="time-entry-editor__error">{error}</div>}
          <div className="time-entry-editor__actions">
            <button className="time-entry-editor__save" onClick={handleSubmit}>
              {isCreate ? 'Add' : 'Save'}
            </button>
            {!isCreate && (
              <button className="time-entry-editor__cancel" onClick={handleCancel}>Cancel</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // View mode (only for edit mode, not create)
  const entry = (props as EditModeProps).entry;
  return (
    <div className="time-entry">
      <div className="time-entry__info">
        <span className="time-entry__date">
          {new Date(entry.startTime).toLocaleDateString()}
        </span>
        <span
          className="time-entry__range time-entry__clickable"
          onClick={handleEdit}
          title="Click to edit"
        >
          {new Date(entry.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {entry.endTime
            ? ` - ${new Date(entry.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : ' - running'}
        </span>
        {entry.note && <span className="time-entry__note">{entry.note}</span>}
      </div>
      <div className="time-entry__right">
        <span
          className="time-entry__duration time-entry__clickable"
          onClick={handleEdit}
          title="Click to edit"
        >
          {entry.durationSeconds != null ? formatDuration(entry.durationSeconds) : 'active'}
        </span>
        {props.onNavigateToTimeline && (
          <button
            className="time-entry__timeline-link"
            onClick={() => props.onNavigateToTimeline!(toDateValue(entry.startTime))}
            title="View in timeline"
          >
            &#9776;
          </button>
        )}
        <button className="time-entry__delete" onClick={() => props.onDelete?.(entry.id)} title="Delete entry">
          &times;
        </button>
      </div>
    </div>
  );
}
