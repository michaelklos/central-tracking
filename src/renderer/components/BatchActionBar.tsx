import React, { useState } from 'react';
import { useTaskContext } from '../context/TaskContext';
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
    selectedTaskIds,
    exitBatchMode,
    batchUpdateTasks,
    batchDeleteTasks,
    categories,
  } = useTaskContext();

  const [status, setStatus] = useState<'' | TaskStatus>('');
  const [source, setSource] = useState<'' | TaskSource>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
          <span>Category:</span>
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
