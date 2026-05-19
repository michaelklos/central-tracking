import React, { useMemo, useState } from 'react';
import { useTaskContext } from '../context/TaskContext';
import { usePluginCapabilities, shouldShowReportedFor } from '../hooks/usePluginCapabilities';
import { ConfirmDialog } from './ConfirmDialog';
import type { TaskStatus, TaskSource } from '../../shared/types';
import './BatchActionBar.css';

const STATUS_OPTIONS: { value: '' | TaskStatus; label: string }[] = [
  { value: '', label: '\u2014 No change \u2014' },
  { value: 'todo', label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];

const SOURCE_OPTIONS: { value: '' | TaskSource; label: string }[] = [
  { value: '', label: '\u2014 No change \u2014' },
  { value: 'ad-hoc', label: 'Ad Hoc' },
  { value: 'email', label: 'Email' },
  { value: 'meeting-prep', label: 'Meeting Prep' },
  { value: 'plugin', label: 'Plugin' },
];

export function BatchActionBar() {
  const {
    tasks,
    selectedTaskIds,
    exitBatchMode,
    batchUpdateTasks,
    batchDeleteTasks,
    batchMarkSelectedReported,
    categories,
  } = useTaskContext();
  const pluginCaps = usePluginCapabilities();

  // Reported-status section is hidden when *every* selected task belongs to a
  // plugin with tracks-reported=false. If the selection is mixed, the section
  // stays visible but a warning calls out that tracking-off tasks are still
  // included (the handler updates them regardless — the gate is UX only).
  const reportedScope = useMemo(() => {
    const ids = Array.from(selectedTaskIds);
    const selected = ids
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
    if (selected.length === 0) return { visible: true, partial: false };
    const tracked = selected.filter((t) => shouldShowReportedFor(t.pluginId, pluginCaps));
    if (tracked.length === 0) return { visible: false, partial: false };
    return { visible: true, partial: tracked.length !== selected.length };
  }, [selectedTaskIds, tasks, pluginCaps]);

  const [status, setStatus] = useState<'' | TaskStatus>('');
  const [source, setSource] = useState<'' | TaskSource>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [reportedDateStart, setReportedDateStart] = useState<string>('');
  const [reportedDateEnd, setReportedDateEnd] = useState<string>('');
  const [reportedNotice, setReportedNotice] = useState<string | null>(null);

  const count = selectedTaskIds.size;

  const handleApply = async () => {
    const input: { status?: TaskStatus; source?: TaskSource; categoryIds?: string[] } = {};
    if (status) input.status = status;
    if (source) input.source = source;
    if (categoryId) input.categoryIds = [categoryId];

    if (Object.keys(input).length === 0) return;
    await batchUpdateTasks(input);
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    await batchDeleteTasks();
  };

  const handleMarkReported = async (reportedAt: string | null) => {
    const result = await batchMarkSelectedReported(reportedAt, {
      dateStart: reportedDateStart || undefined,
      dateEnd: reportedDateEnd || undefined,
    });
    const verb = reportedAt === null ? 'unreported' : 'reported';
    setReportedNotice(`Marked ${result.changed} entr${result.changed === 1 ? 'y' : 'ies'} as ${verb}.`);
    setTimeout(() => setReportedNotice(null), 4000);
  };

  const hasChanges = status !== '' || source !== '' || categoryId !== '';

  return (
    <div className="batch-bar">
      <div className="batch-bar__count">
        {count} task{count !== 1 ? 's' : ''} selected
      </div>

      <div className="batch-bar__section">
        <h4 className="batch-bar__section-title">Update</h4>

        <label className="batch-bar__field">
          <span>Status:</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as '' | TaskStatus)}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        <label className="batch-bar__field">
          <span>Source:</span>
          <select value={source} onChange={(e) => setSource(e.target.value as '' | TaskSource)}>
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        <label className="batch-bar__field">
          <span>Add category:</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{'\u2014'} No change {'\u2014'}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </label>

        <button
          className="batch-bar__apply"
          onClick={handleApply}
          disabled={count === 0 || !hasChanges}
        >
          Apply Changes
        </button>
      </div>

      {reportedScope.visible && (
      <div className="batch-bar__section">
        <h4 className="batch-bar__section-title">Reported status</h4>
        <div className="batch-bar__hint">
          Apply to every time entry on the selected task{count !== 1 ? 's' : ''}.
          Leave both dates blank to cover all entries; set bounds (inclusive) to
          narrow the scope.
        </div>
        {reportedScope.partial && (
          <div className="batch-bar__hint batch-bar__hint--warn">
            Some selected tasks belong to plugins that do not track reported state.
            They will still be updated.
          </div>
        )}
        <div className="batch-bar__date-row">
          <input
            type="date"
            value={reportedDateStart}
            onChange={(e) => setReportedDateStart(e.target.value)}
            aria-label="Reported scope start date"
          />
          <span>to</span>
          <input
            type="date"
            value={reportedDateEnd}
            onChange={(e) => setReportedDateEnd(e.target.value)}
            aria-label="Reported scope end date"
          />
        </div>
        <div className="batch-bar__reported-actions">
          <button
            className="batch-bar__apply"
            onClick={() => handleMarkReported(new Date().toISOString())}
            disabled={count === 0}
          >
            Mark Reported
          </button>
          <button
            className="batch-bar__apply"
            onClick={() => handleMarkReported(null)}
            disabled={count === 0}
          >
            Mark Unreported
          </button>
        </div>
        {reportedNotice && (
          <div className="batch-bar__notice" role="status">{reportedNotice}</div>
        )}
      </div>
      )}

      <div className="batch-bar__section batch-bar__section--danger">
        <h4 className="batch-bar__section-title">Danger</h4>
        <button
          className="batch-bar__delete"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={count === 0}
        >
          Delete Selected
        </button>
      </div>

      <button className="batch-bar__cancel" onClick={exitBatchMode}>
        Cancel
      </button>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Tasks"
          message={`Move ${count} task${count !== 1 ? 's' : ''} to the recycle bin? You can restore them later.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
