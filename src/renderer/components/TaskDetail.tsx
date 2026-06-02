import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskContext } from '../context/TaskContext';
import { useTimerContext } from '../context/TimerContext';
import { usePluginCapabilities, shouldShowReportedFor } from '../hooks/usePluginCapabilities';
import { formatDuration, startOfDay, endOfDay } from '../utils/time';
import { useMarkdownTextarea } from '../hooks/useMarkdownTextarea';
import { TimeEntryEditor } from './TimeEntryEditor';
import { TimeEntryScrollSentinel } from './TimeEntryScrollSentinel';
import { ConfirmDialog } from './ConfirmDialog';
import { LinkPluginDialog, type LinkSubmit } from './LinkPluginDialog';
import { getStringSetting } from './OptionsMenu';
import type { Task, TimeEntry, Comment, TaskStatus, TaskSource } from '../../shared/types';
import { allowedAdoStatusTargets } from '../utils/adoFsm';
import './TaskDetail.css';

type DetailTab = 'details' | 'time' | 'comments' | 'notes';

const STATUS_OPTIONS: TaskStatus[] = ['todo', 'in-progress', 'done', 'blocked'];
const SOURCE_OPTIONS: TaskSource[] = ['ad-hoc', 'email', 'meeting-prep', 'plugin'];

const TIME_ENTRIES_LIMIT = 20;
const AUTO_LOAD_MAX_BATCHES = 3;

export function TaskDetail() {
  const navigate = useNavigate();
  const { tasks, selectedTaskId, selectTask, updateTask, deleteTask, categories, refreshActiveTasks, pendingTimeEntry, setPendingTimeEntry } = useTaskContext();
  const { startTimer, stopTimer, isRunningForTask, elapsedSeconds, refreshTodayTotal, refreshActiveEntry, activeEntry } = useTimerContext();
  const pluginCaps = usePluginCapabilities();

  const [activeTab, setActiveTab] = useState<DetailTab>('details');
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [timeEntriesTotal, setTimeEntriesTotal] = useState(0);
  const [timeEntriesHasMore, setTimeEntriesHasMore] = useState(false);
  const [timeEntryLoadCount, setTimeEntryLoadCount] = useState(0);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentSyncable, setCommentSyncable] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [defaultStartTime, setDefaultStartTime] = useState(new Date().toISOString());
  const [defaultDurationSeconds, setDefaultDurationSeconds] = useState(() => {
    const min = parseInt(getStringSetting('ct-option-default-duration-min', '30'), 10);
    return (!isNaN(min) && min > 0) ? min * 60 : 1800;
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditDraft, setCommentEditDraft] = useState('');

  // Track which task the entries are loaded for to prevent stale appends
  const loadedForTaskRef = useRef<string | null>(null);

  // Track pendingTimeEntry so loadSmartDefaults can check without re-firing
  const pendingTimeEntryRef = useRef(pendingTimeEntry);
  pendingTimeEntryRef.current = pendingTimeEntry;

  const task = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Track which task is currently selected via a ref so async loaders can
  // detect stale completions (user clicked a different task while a fetch was
  // in flight) and bail before calling setState with the wrong task's data.
  const currentTaskIdRef = useRef<string | null>(selectedTaskId);
  currentTaskIdRef.current = selectedTaskId;

  const loadTimeEntries = useCallback(async () => {
    const taskId = selectedTaskId;
    if (!taskId) return;
    setIsLoadingEntries(true);
    const res = await window.api.timeEntries.getByTaskPaginated(taskId, {
      offset: 0,
      limit: TIME_ENTRIES_LIMIT,
    });
    if (currentTaskIdRef.current !== taskId) return;
    setTimeEntries(res.items);
    setTimeEntriesTotal(res.total);
    setTimeEntriesHasMore(res.hasMore);
    setTimeEntryLoadCount(1);
    loadedForTaskRef.current = taskId;
    setIsLoadingEntries(false);
  }, [selectedTaskId]);

  const loadMoreTimeEntries = useCallback(async () => {
    const taskId = selectedTaskId;
    if (!taskId || isLoadingEntries || !timeEntriesHasMore) return;
    if (loadedForTaskRef.current !== taskId) return;
    setIsLoadingEntries(true);
    const res = await window.api.timeEntries.getByTaskPaginated(taskId, {
      offset: timeEntries.length,
      limit: TIME_ENTRIES_LIMIT,
    });
    if (currentTaskIdRef.current !== taskId) return;
    setTimeEntries((prev) => [...prev, ...res.items]);
    setTimeEntriesTotal(res.total);
    setTimeEntriesHasMore(res.hasMore);
    setTimeEntryLoadCount((prev) => prev + 1);
    setIsLoadingEntries(false);
  }, [selectedTaskId, isLoadingEntries, timeEntriesHasMore, timeEntries.length]);

  const loadComments = useCallback(async () => {
    const taskId = selectedTaskId;
    if (!taskId) return;
    const cmts = await window.api.comments.getByTask(taskId);
    if (currentTaskIdRef.current !== taskId) return;
    setComments(cmts);
  }, [selectedTaskId]);

  const prevActiveIdRef = useRef<string | null>(activeEntry?.id ?? null);
  useEffect(() => {
    const cur = activeEntry?.id ?? null;
    if (prevActiveIdRef.current === cur) return;
    prevActiveIdRef.current = cur;
    loadTimeEntries(); // stopped entry now renders its end time instead of "- running"
  }, [activeEntry, loadTimeEntries]);

  const loadSmartDefaults = useCallback(async () => {
    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const todayEnd = endOfDay(now).toISOString();
    const allTodayEntries = await window.api.timeEntries.getByDateRange(todayStart, todayEnd);
    const completedToday = allTodayEntries
      .filter((e) => e.endTime)
      .sort((a, b) => new Date(b.endTime!).getTime() - new Date(a.endTime!).getTime());

    if (completedToday.length > 0) {
      setDefaultStartTime(completedToday[0].endTime!);
    } else {
      setDefaultStartTime(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    if (task) {
      setTitleDraft(task.title);
      setDescDraft(task.description);
      setNotesDraft(task.notes ?? '');
    }
    loadTimeEntries();
    loadComments();
    // Only load smart defaults if there's no pending time entry (gap click)
    // to avoid the async overwrite race condition
    if (!pendingTimeEntryRef.current) {
      loadSmartDefaults();
    }
  }, [task?.id, loadTimeEntries, loadComments, loadSmartDefaults]);

  useEffect(() => {
    if (pendingTimeEntry && selectedTaskId) {
      setActiveTab('time');
      setDefaultStartTime(pendingTimeEntry.startTime);
      const duration = Math.floor(
        (new Date(pendingTimeEntry.endTime).getTime() - new Date(pendingTimeEntry.startTime).getTime()) / 1000
      );
      const fallbackMin = parseInt(getStringSetting('ct-option-default-duration-min', '30'), 10);
      const fallbackSecs = (!isNaN(fallbackMin) && fallbackMin > 0) ? fallbackMin * 60 : 1800;
      setDefaultDurationSeconds(duration > 0 ? duration : fallbackSecs);
      setPendingTimeEntry(null);
    }
  }, [pendingTimeEntry, selectedTaskId, setPendingTimeEntry]);

  // These three handlers feed useMarkdownTextarea below, which must be called
  // unconditionally every render. They're defined as useCallback (and therefore
  // also count as hooks) BEFORE the early return so React's hook counter stays
  // consistent across renders where `task` toggles between defined and null.
  const handleSaveDesc = useCallback(async () => {
    if (!task) return;
    if (descDraft !== task.description) {
      await updateTask(task.id, { description: descDraft });
    }
  }, [task, descDraft, updateTask]);

  const handleSaveNotes = useCallback(async () => {
    if (!task) return;
    if (notesDraft !== (task.notes ?? '')) {
      await updateTask(task.id, { notes: notesDraft });
    }
  }, [task, notesDraft, updateTask]);

  const handleAddComment = useCallback(async () => {
    if (!task) return;
    const body = newComment.trim();
    if (!body) return;
    // Only force syncable on full-mirror ADO tasks. Link-only ADO tasks
    // (pluginId='ado' but source != 'plugin') let the user toggle per
    // comment via `commentSyncable`, matching the link-mode contract that
    // pushes are opt-in.
    const isAdoFullMirror = task.source === 'plugin' && task.pluginId === 'ado';
    const syncable = isAdoFullMirror ? true : commentSyncable;
    await window.api.comments.create({ taskId: task.id, body, syncable });
    setNewComment('');
    await loadComments();
  }, [task, newComment, commentSyncable, loadComments]);

  const descMd = useMarkdownTextarea({ value: descDraft, onChange: setDescDraft, onSave: handleSaveDesc });
  const notesMd = useMarkdownTextarea({ value: notesDraft, onChange: setNotesDraft, onSave: handleSaveNotes });
  const commentMd = useMarkdownTextarea({ value: newComment, onChange: setNewComment, onSave: handleAddComment });

  const handleSaveCommentEdit = useCallback(async () => {
    const id = editingCommentId;
    if (!id) return;
    const body = commentEditDraft.trim();
    const original = comments.find((c) => c.id === id);
    if (original && body && body !== original.body) {
      await window.api.comments.update(id, { body });
    }
    setEditingCommentId(null);
    await loadComments();
  }, [editingCommentId, commentEditDraft, comments, loadComments]);

  const commentEditMd = useMarkdownTextarea({
    value: commentEditDraft,
    onChange: setCommentEditDraft,
    onSave: handleSaveCommentEdit,
  });

  if (!task) return null;

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) {
      await updateTask(task.id, { title: trimmed });
    }
    setEditingTitle(false);
  };

  const handleStatusChange = async (status: TaskStatus) => {
    try {
      setActionError(null);
      await updateTask(task.id, { status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Backend rejects illegal ADO transitions with INVALID_ADO_TRANSITION.
      // Surface the message inline rather than letting the promise dangle.
      setActionError(`Status change rejected: ${msg}`);
      window.api.log.error(`TaskDetail.handleStatusChange: ${msg}`);
    }
  };

  const handleComplete = async () => {
    try {
      setActionError(null);
      if (isRunningForTask(task.id)) {
        await stopTimer();
      }
      await updateTask(task.id, { status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Failed to complete task: ${msg}`);
      window.api.log.error(`TaskDetail.handleComplete: ${msg}`);
    }
  };

  const handleReactivate = async () => {
    await updateTask(task.id, { status: 'todo' });
    await startTimer(task.id);
  };

  const handleCategoryToggle = async (catId: string) => {
    const current = task.categoryIds;
    const next = current.includes(catId)
      ? current.filter((id) => id !== catId)
      : [...current, catId];
    await updateTask(task.id, { categoryIds: next });
  };

  const handleDeleteComment = async (id: string) => {
    await window.api.comments.delete(id);
    await loadComments();
  };

  const handleDeleteTimeEntry = async (id: string) => {
    await window.api.timeEntries.delete(id);
    setTimeEntries((prev) => prev.filter((e) => e.id !== id));
    setTimeEntriesTotal((prev) => prev - 1);
    await loadSmartDefaults();
    await refreshActiveTasks();
    await refreshTodayTotal();
  };

  const handleCreateEntry = async (startTime: string, endTime: string, note: string) => {
    const entry = await window.api.timeEntries.create({ taskId: task.id, startTime, endTime, note });
    setTimeEntries((prev) => [entry, ...prev]);
    setTimeEntriesTotal((prev) => prev + 1);
    await loadSmartDefaults();
    await refreshActiveTasks();
    await refreshTodayTotal();
  };

  const handleUpdateEntry = async (id: string, startTime: string, endTime: string | null, note: string) => {
    const updated = await window.api.timeEntries.update(id, { startTime, endTime, note });
    setTimeEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    await loadSmartDefaults();
    await refreshActiveTasks();
    await refreshTodayTotal();
    // If we just edited the running entry (no endTime), re-anchor the live
    // timer so the TimerBar's elapsed counter reflects the new start.
    if (updated.endTime === null) {
      await refreshActiveEntry();
    }
  };

  const handleToggleEntryReported = async (id: string, reportedAt: string | null) => {
    try {
      setActionError(null);
      const updated = await window.api.timeEntries.update(id, { reportedAt });
      setTimeEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
      await refreshActiveTasks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Failed to update reported state: ${msg}`);
      window.api.log.error(`TaskDetail.handleToggleEntryReported: ${msg}`);
    }
  };

  const handleMarkReported = async () => {
    try {
      setActionError(null);
      await window.api.timeEntries.markTaskReported(task.id, new Date().toISOString());
      await loadTimeEntries();
      await refreshActiveTasks();
      await refreshTodayTotal();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Failed to mark reported: ${msg}`);
      window.api.log.error(`TaskDetail.handleMarkReported: ${msg}`);
    }
  };

  const handleUnmarkReported = async () => {
    try {
      setActionError(null);
      await window.api.timeEntries.markTaskReported(task.id, null);
      await loadTimeEntries();
      await refreshActiveTasks();
      await refreshTodayTotal();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Failed to unmark reported: ${msg}`);
      window.api.log.error(`TaskDetail.handleUnmarkReported: ${msg}`);
    }
  };

  const handleTimerToggle = async () => {
    try {
      setActionError(null);
      if (isRunningForTask(task.id)) {
        await stopTimer();
      } else {
        await startTimer(task.id);
      }
      await loadTimeEntries();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Timer toggle failed: ${msg}`);
      window.api.log.error(`TaskDetail.handleTimerToggle: ${msg}`);
    }
  };

  const handleNavigateToTimeline = (date: string) => {
    navigate('/timeline?date=' + date);
  };

  const running = isRunningForTask(task.id);
  const todayDisplay = running ? task.todayTimeSeconds + elapsedSeconds : task.todayTimeSeconds;
  const totalDisplay = running ? task.totalTimeSeconds + elapsedSeconds : task.totalTimeSeconds;

  const hasNotes = (task.notes ?? '').length > 0;
  // Read-only UX (title/notes lock, FSM dropdown) applies only to full
  // mirrors. Link-only ADO tasks (pluginId='ado' but source != 'plugin')
  // are still locally editable — the plugin link just lets the user push
  // time/comments without ADO owning the row.
  const isAdo = task.source === 'plugin' && task.pluginId === 'ado';
  const refreshedAtLabel = task.externalRefreshedAt
    ? new Date(task.externalRefreshedAt).toLocaleString()
    : 'never';

  // Show scroll sentinel for auto-loading (first 3 batches), then "Load more" link
  const showScrollSentinel = timeEntriesHasMore && timeEntryLoadCount < AUTO_LOAD_MAX_BATCHES && !isLoadingEntries;
  const showLoadMoreLink = timeEntriesHasMore && timeEntryLoadCount >= AUTO_LOAD_MAX_BATCHES && !isLoadingEntries;

  return (
    <div className="task-detail">
      {actionError && (
        <div className="task-detail__action-error" role="alert">
          {actionError}
          <button
            className="task-detail__action-error-close"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}
      <div className="task-detail__header">
        <div className="task-detail__title-row">
          {editingTitle ? (
            <input
              className="task-detail__title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
              autoFocus
            />
          ) : (
            <h2
              className={`task-detail__title${isAdo ? ' task-detail__title--readonly' : ''}`}
              onClick={isAdo ? undefined : () => setEditingTitle(true)}
              title={isAdo ? 'Title owned by ADO (read-only)' : undefined}
            >
              {isAdo && <span aria-hidden="true" className="task-detail__lock">🔒 </span>}
              {task.title}
            </h2>
          )}
          <div className="task-detail__header-actions">
            {task.status !== 'done' ? (
              <button
                className="task-detail__complete-btn"
                onClick={handleComplete}
                title="Mark as done"
              >
                &#10003;
              </button>
            ) : (
              <button
                className="task-detail__reactivate-btn"
                onClick={handleReactivate}
                title="Reactivate task"
              >
                &#8634;
              </button>
            )}
            <button className="task-detail__close" onClick={() => selectTask(null)}>
              &times;
            </button>
          </div>
        </div>

        <div className="task-detail__time-summary">
          <div className="task-detail__time-block">
            <span className="task-detail__time-label">Today</span>
            <span className={`task-detail__time-value ${running ? 'task-detail__time-value--active' : ''}`}>
              {formatDuration(todayDisplay)}
            </span>
          </div>
          <div className="task-detail__time-block">
            <span className="task-detail__time-label">Total</span>
            <span className="task-detail__time-value">{formatDuration(totalDisplay)}</span>
          </div>
          <button
            className={`task-detail__timer-btn ${running ? 'task-detail__timer-btn--active' : ''}`}
            onClick={handleTimerToggle}
          >
            {running ? '■ Stop' : '▶ Start'}
          </button>
        </div>

        {task.totalTimeSeconds > 0 && shouldShowReportedFor(task.pluginId, pluginCaps) && (
          <div className="task-detail__report-state">
            {task.hasUnreportedTime ? (
              <>
                <span className="task-detail__report-chip task-detail__report-chip--pending">
                  ⚠ {formatDuration(task.unreportedTimeSeconds)} unreported
                </span>
                <button
                  className="task-detail__report-btn"
                  onClick={handleMarkReported}
                  title="Mark all un-reported entries on this task as reported"
                >
                  Mark as reported
                </button>
              </>
            ) : (
              <>
                <span className="task-detail__report-chip task-detail__report-chip--done">
                  ✓ Reported
                </span>
                <button
                  className="task-detail__report-btn"
                  onClick={handleUnmarkReported}
                  title="Mark all entries on this task as not reported"
                >
                  Unmark reported
                </button>
              </>
            )}
          </div>
        )}

        {isAdo && (
          <div className="task-detail__ado-panel">
            <div className="task-detail__ado-row">
              <span className="task-detail__ado-state">
                State: <strong>{task.externalState ?? 'unknown'}</strong>
              </span>
              {task.externalUrl && (
                <a
                  href={task.externalUrl}
                  className="task-detail__ado-link"
                  onClick={(e) => {
                    e.preventDefault();
                    if (task.externalUrl) window.api.shell.openExternal(task.externalUrl);
                  }}
                >
                  Open in ADO ↗
                </a>
              )}
            </div>
            <div className="task-detail__ado-row task-detail__ado-row--sub">
              <span>ADO logged: {(task.externalCompletedHours ?? 0).toFixed(2)} hrs</span>
              <span>Last refresh: {refreshedAtLabel}</span>
              {task.stateDirty && (
                <span className="task-detail__ado-dirty" title="ct status change not yet pushed to ADO">
                  ● state pending push
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="task-detail__tabs">
        {(['details', 'time', 'comments', 'notes'] as DetailTab[]).map((tab) => (
          <button
            key={tab}
            className={`task-detail__tab ${activeTab === tab ? 'task-detail__tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'details'
              ? 'Details'
              : tab === 'time'
                ? `Time (${timeEntriesTotal})`
                : tab === 'comments'
                  ? `Comments (${comments.length})`
                  : hasNotes
                    ? 'Notes*'
                    : 'Notes'}
          </button>
        ))}
      </div>

      <div className="task-detail__body">
        {activeTab === 'details' && (
          <div className="task-detail__details">
            <div className="task-detail__field">
              <label>Status</label>
              <select value={task.status} onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}>
                {(isAdo ? allowedAdoStatusTargets(task.status) : STATUS_OPTIONS).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {isAdo && task.status === 'done' && (
                <div className="task-detail__readonly-hint">
                  Reopen (done → in-progress) may be rejected by ADO; ct will revert from ADO on next pull if so.
                </div>
              )}
            </div>

            <div className="task-detail__field">
              <label>Source</label>
              <span className="task-detail__source-badge">{task.source}</span>
              {task.externalId && (
                <span className="task-detail__external-id">#{task.externalId}</span>
              )}
              {task.pluginId && task.externalId && !isAdo && (
                <span
                  className="task-detail__link-badge"
                  title={`Linked to ${task.pluginId} ticket ${task.externalId}`}
                >
                  ⛓ {task.pluginId}#{task.externalId}
                </span>
              )}
              {task.pluginId == null ? (
                <button
                  type="button"
                  className="task-detail__link-btn"
                  onClick={() => setShowLinkDialog(true)}
                >
                  Link to plugin…
                </button>
              ) : (
                <button
                  type="button"
                  className="task-detail__link-btn"
                  onClick={() => setShowUnlinkConfirm(true)}
                >
                  Unlink
                </button>
              )}
            </div>

            <div className="task-detail__field">
              <label>
                Description
                {isAdo && <span className="task-detail__readonly-hint"> (read-only — ADO owns)</span>}
              </label>
              <textarea
                rows={4}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={handleSaveDesc}
                onKeyDown={descMd.onKeyDown}
                placeholder="Add a description..."
                disabled={isAdo}
              />
            </div>

            <div className="task-detail__field">
              <label>Categories</label>
              <div className="task-detail__cat-list">
                {categories.length === 0 && (
                  <span className="task-detail__no-categories">No categories</span>
                )}
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    className={`task-detail__cat-chip ${task.categoryIds.includes(cat.id) ? 'task-detail__cat-chip--active' : ''}`}
                    style={{ '--cat-color': cat.color } as React.CSSProperties}
                    onClick={() => handleCategoryToggle(cat.id)}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="task-detail__actions">
              <button
                className="task-detail__delete-btn"
                onClick={() => {
                  const confirmEnabled = localStorage.getItem('ct-option-confirm-delete') !== 'false';
                  if (confirmEnabled) {
                    setShowDeleteConfirm(true);
                  } else {
                    deleteTask(task.id);
                  }
                }}
              >
                Delete Task
              </button>
            </div>
          </div>
        )}

        {activeTab === 'time' && (
          <div className="task-detail__time-entries">
            <TimeEntryEditor
              mode="create"
              allEntries={timeEntries}
              onCreate={handleCreateEntry}
              defaultStartTime={defaultStartTime}
              defaultDurationSeconds={defaultDurationSeconds}
            />
            {timeEntries.length === 0 && !isLoadingEntries && (
              <p className="task-detail__empty">No time entries yet. Start the timer or add an entry above.</p>
            )}
            {timeEntries.map((entry) => (
              <TimeEntryEditor
                key={entry.id}
                entry={entry}
                allEntries={timeEntries}
                onSave={handleUpdateEntry}
                onCancel={() => {}}
                onDelete={handleDeleteTimeEntry}
                onNavigateToTimeline={handleNavigateToTimeline}
                onReportedToggle={handleToggleEntryReported}
              />
            ))}
            {showScrollSentinel && (
              <TimeEntryScrollSentinel onVisible={loadMoreTimeEntries} />
            )}
            {showLoadMoreLink && (
              <button className="task-detail__load-more" onClick={loadMoreTimeEntries}>
                Load more time entries...
              </button>
            )}
            {isLoadingEntries && timeEntries.length > 0 && (
              <div className="task-detail__loading">Loading...</div>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="task-detail__comments">
            <div className="task-detail__comment-form">
              <textarea
                rows={3}
                placeholder="Add a comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onBlur={handleAddComment}
                onKeyDown={commentMd.onKeyDown}
              />
              <div className="task-detail__comment-actions">
                {!isAdo && (
                  <label className="task-detail__sync-toggle">
                    <input
                      type="checkbox"
                      checked={commentSyncable}
                      onChange={(e) => setCommentSyncable(e.target.checked)}
                    />
                    Sync to source
                  </label>
                )}
                <button className="task-detail__comment-submit" onClick={handleAddComment}>
                  Add Comment
                </button>
              </div>
            </div>

            {comments.length === 0 && (
              <p className="task-detail__empty">No comments yet.</p>
            )}
            {comments.map((comment) => {
              const fromAdo = comment.externalId !== null;
              return (
                <div key={comment.id} className={`comment${fromAdo ? ' comment--external' : ''}`}>
                  <div className="comment__header">
                    <span className="comment__date">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                    <div className="comment__badges">
                      {fromAdo ? (
                        <span className="comment__sync-badge comment__sync-badge--external">ADO</span>
                      ) : comment.syncable ? (
                        <span className={`comment__sync-badge ${comment.synced ? 'comment__sync-badge--synced' : ''}`}>
                          {comment.synced ? 'synced' : 'will sync'}
                        </span>
                      ) : (
                        <span className="comment__sync-badge comment__sync-badge--local">local only</span>
                      )}
                      {!fromAdo && (
                        <button
                          className="comment__delete"
                          onClick={() => handleDeleteComment(comment.id)}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                  {editingCommentId === comment.id ? (
                    <textarea
                      className="comment__body-editor"
                      rows={3}
                      value={commentEditDraft}
                      onChange={(e) => setCommentEditDraft(e.target.value)}
                      onBlur={handleSaveCommentEdit}
                      onKeyDown={commentEditMd.onKeyDown}
                      autoFocus
                    />
                  ) : !fromAdo ? (
                    <p
                      className="comment__body comment__clickable"
                      title="Click to edit"
                      onClick={() => { setEditingCommentId(comment.id); setCommentEditDraft(comment.body); }}
                    >
                      {comment.body}
                    </p>
                  ) : (
                    <p className="comment__body">{comment.body}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="task-detail__notes">
            <textarea
              className="task-detail__notes-editor"
              rows={12}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={handleSaveNotes}
              onKeyDown={notesMd.onKeyDown}
              placeholder="Add notes..."
              disabled={isAdo}
            />
            <div className="task-detail__notes-hint">
              {isAdo
                ? 'Notes mirror ADO description (read-only).'
                : `Auto-saves on blur. ${window.api.platform === 'darwin' ? '⌘S' : 'Ctrl+S'} saves immediately.`}
            </div>
          </div>
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Task"
          message={`Move "${task.title}" to the recycle bin?`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => {
            setShowDeleteConfirm(false);
            deleteTask(task.id);
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {showLinkDialog && (
        <LinkPluginDialog
          onCancel={() => setShowLinkDialog(false)}
          onSubmit={async (input: LinkSubmit) => {
            await window.api.tasks.link(task.id, input);
            setShowLinkDialog(false);
            await refreshActiveTasks();
          }}
        />
      )}

      {showUnlinkConfirm && (
        <ConfirmDialog
          title="Unlink plugin"
          message={
            task.source === 'plugin'
              ? `Unlink "${task.title}" from ${task.pluginId}? The task becomes a local task again (source reset to ad-hoc) and mirrored state will be cleared.`
              : task.pluginId !== null
                ? `Remove the ${task.pluginId} link from "${task.title}"? The task stays as-is; only the link to the remote work item is cleared.`
                : `Remove plugin link from "${task.title}"? The task itself stays.`
          }
          confirmLabel="Unlink"
          onConfirm={async () => {
            setShowUnlinkConfirm(false);
            await window.api.tasks.unlink(task.id);
            await refreshActiveTasks();
          }}
          onCancel={() => setShowUnlinkConfirm(false)}
        />
      )}
    </div>
  );
}
