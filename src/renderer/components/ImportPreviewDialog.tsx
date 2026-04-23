import React from 'react';
import type { ImportPreviewItem, ImportError } from '../../shared/types';
import { formatDurationHuman } from '../utils/duration';
import './ImportPreviewDialog.css';

interface ImportPreviewDialogProps {
  items: ImportPreviewItem[];
  errors: ImportError[];
  filePath: string;
  onToggleAction: (index: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function sourceLabel(pluginId: string | null, source: string): string {
  if (pluginId === 'ado') return 'ADO';
  if (pluginId === 'jira') return 'Jira';
  return source;
}

export function ImportPreviewDialog({
  items,
  errors,
  filePath,
  onToggleAction,
  onConfirm,
  onCancel,
}: ImportPreviewDialogProps) {
  const createCount = items.filter((i) => i.action === 'create').length;
  const skipCount = items.filter((i) => i.action === 'skip').length;

  return (
    <div className="import-overlay" onClick={onCancel}>
      <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="import-dialog__title">Import Preview</h2>
        <p className="import-dialog__file">{filePath}</p>
        <p className="import-dialog__summary">
          {createCount} to create, {skipCount} to skip
        </p>

        {items.length > 0 && (
          <div className="import-dialog__table-wrap">
            <table className="import-dialog__table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Ticket</th>
                  <th>Source</th>
                  <th>Date</th>
                  <th>Start</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr
                    key={index}
                    className={item.existingTask ? 'import-dialog__row--duplicate' : ''}
                  >
                    <td>{item.title}</td>
                    <td>{item.externalId ?? '—'}</td>
                    <td>{sourceLabel(item.pluginId, item.source)}</td>
                    <td>{item.date}</td>
                    <td>{item.startTime}</td>
                    <td>{formatDurationHuman(item.durationSeconds)}</td>
                    <td>
                      {item.existingTask ? (
                        <span className="import-dialog__badge import-dialog__badge--duplicate" title={`Existing: ${item.existingTask.title}`}>
                          duplicate
                        </span>
                      ) : (
                        <span className="import-dialog__badge import-dialog__badge--new">new</span>
                      )}
                    </td>
                    <td>
                      <button
                        className={`import-dialog__action-btn import-dialog__action-btn--${item.action}`}
                        onClick={() => onToggleAction(index)}
                      >
                        {item.action}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {errors.length > 0 && (
          <div className="import-dialog__errors">
            <h3>Parse Errors</h3>
            <ul>
              {errors.map((err, i) => (
                <li key={i}>
                  Line {err.lineNumber}: {err.reason} — <code>{err.line}</code>
                </li>
              ))}
            </ul>
            <details className="import-dialog__format-hint">
              <summary>Expected file format</summary>
              <pre>{`# YYYY-MM-DD
* Task Name: HH:MM (duration)
* [TICKET] Task Name: HH:MM (1h 30m)

// Lines starting with // are comments`}</pre>
              <ul>
                <li><strong>Date header</strong> — one per day block, e.g. <code># 2024-03-20</code></li>
                <li><strong>Start time</strong> — 24-hour format, e.g. <code>09:00</code> or <code>14:30</code></li>
                <li><strong>Duration</strong> — e.g. <code>45m</code>, <code>1h</code>, <code>1h 30m</code>, <code>2 hours</code></li>
                <li><strong>Ticket</strong> (optional) — plain number for ADO, <code>ABC-123</code> format for Jira</li>
              </ul>
            </details>
          </div>
        )}

        <div className="import-dialog__actions">
          <button className="import-dialog__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="import-dialog__confirm"
            onClick={onConfirm}
            disabled={createCount === 0}
          >
            Import {createCount} Task{createCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
