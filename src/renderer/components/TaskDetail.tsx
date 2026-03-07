import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTaskContext } from '../context/TaskContext';
import { useTimerContext } from '../context/TimerContext';
import { formatDuration, startOfDay, endOfDay } from '../utils/time';
import { TimeEntryEditor } from './TimeEntryEditor';
import { TimeEntryScrollSentinel } from './TimeEntryScrollSentinel';
import { ConfirmDialog } from './ConfirmDialog';
import type { Task, TimeEntry, Comment, TaskStatus, TaskSource } from '../../shared/types';
import './TaskDetail.css';

type DetailTab = 'details' | 'time' | 'comments' | 'notes';

const STATUS_OPTIONS: TaskStatus[] = ['todo', 'in-progress', 'done', 'blocked'];
const SOURCE_OPTIONS: TaskSource[] = ['ad-hoc', 'email', 'meeting-prep', 'plugin'];

const TIME_ENTRIES_LIMIT = 20;
const AUTO_LOAD_MAX_BATCHES = 3;

export function TaskDetail() {
  const navigate = useNavigate();
  const { tasks, selectedTaskId, selectTask, updateTask, deleteTask, categories, pendingTimeEntry, setPendingTimeEntry } = useTaskContext();
  const { startTimer, stopTimer, isRunningForTask, elapsedSeconds } = useTimerContext();

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
  const [defaultDurationSeconds, setDefaultDurationSeconds] = useState(1800);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Track which task the entries are loaded for to prevent stale appends
  const loadedForTaskRef = useRef<string | null>(null);

  // Track pendingTimeEntry so loadSmartDefaults can check without re-firing
  const pendingTimeEntryRef = useRef(pendingTimeEntry);
  pendingTimeEntryRef.current = pendingTimeEntry;

  const task = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const loadTimeEntries = useCallback(async () => {
    if (!selectedTaskId) return;
    setIsLoadingEntries(true);
    const res = await window.api.timeEntries.getByTaskPaginated(selectedTaskId, {
      offset: 0,
      limit: TIME_ENTRIES_LIMIT,
    });
    setTimeEntries(res.items);
    setTimeEntriesTotal(res.total);
    setTimeEntriesHasMore(res.hasMore);
    setTimeEntryLoadCount(1);
    loadedForTaskRef.current = selectedTaskId;
    setIsLoadingEntries(false);
  }, [selectedTaskId]);

  const loadMoreTimeEntries = useCallback(async () => {
    if (!selectedTaskId || isLoadingEntries || !timeEntriesHasMore) return;
    if (loadedForTaskRef.current !== selectedTaskId) return;
    setIsLoadingEntries(true);
    const res = await window.api.timeEntries.getByTaskPaginated(selectedTaskId, {
      offset: timeEntries.length,
      limit: TIME_ENTRIES_LIMIT,
    });
    setTimeEntries((prev) => [...prev, ...res.items]);
    setTimeEntriesTotal(res.total);
    setTimeEntriesHasMore(res.hasMore);
    setTimeEntryLoadCount((prev) => prev + 1);
    setIsLoadingEntries(false);
  }, [selectedTaskId, isLoadingEntries, timeEntriesHasMore, timeEntries.length]);

  const loadComments = useCallback(async () => {
    if (!selectedTaskId) return;
    const cmts = await window.api.comments.getByTask(selectedTaskId);
    setComments(cmts);
  }, [selectedTaskId]);

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
      setDefaultDurationSeconds(duration > 0 ? duration : 1800);
      setPendingTimeEntry(null);
    }
  }, [pendingTimeEntry, selectedTaskId, setPendingTimeEntry]);

  if (!task) return null;

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task.title) {
      await updateTask(task.id, { title: trimmed });
    }
    setEditingTitle(false);
  };

  const handleSaveDesc = async () => {
    if (descDraft !== task.description) {
      await updateTask(task.id, { description: descDraft });
    }
  };

  const handleSaveNotes = async () => {
    if (notesDraft !== (task.notes ?? '')) {
      await updateTask(task.id, { notes: notesDraft });
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    await updateTask(task.id, { status });
  };

  const handleComplete = async () => {
    if (isRunningForTask(task.id)) {
      await stopTimer();
    }
    await updateTask(task.id, { status: 'done' });
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

  const handleAddComment = async () => {
    const body = newComment.trim();
    if (!body) return;
    await window.api.comments.create({ taskId: task.id, body, syncable: commentSyncable });
    setNewComment('');
    await loadComments();
  };

  const handleDeleteComment = async (id: string) => {
    await window.api.comments.delete(id);
    await loadComments();
  };

  const handleDeleteTimeEntry = async (id: string) => {
    await window.api.timeEntries.delete(id);
    // Inline removal
    setTimeEntries((prev) => prev.filter((e) => e.id !== id));
    setTimeEntriesTotal((prev) => prev - 1);
    await loadSmartDefaults();
  };

  const handleCreateEntry = async (startTime: string, endTime: string, note: string) => {
    const entry = await window.api.timeEntries.create({ taskId: task.id, startTime, endTime, note });
    // Inline prepend (newest first)
    setTimeEntries((prev) => [entry, ...prev]);
    setTimeEntriesTotal((prev) => prev + 1);
    await loadSmartDefaults();
  };

  const handleUpdateEntry = async (id: string, startTime: string, endTime: string, note: string) => {
    const updated = await window.api.timeEntries.update(id, { startTime, endTime, note });
    // Inline replace
    setTimeEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    await loadSmartDefaults();
  };

  const handleTimerToggle = async () => {
    if (isRunningForTask(task.id)) {
      await stopTimer();
    } else {
      await startTimer(task.id);
    }
    await loadTimeEntries();
  };

  const handleNavigateToTimeline = (date: string) => {
    navigate('/timeline?date=' + date);
  };

  const running = isRunningForTask(task.id);
  const todayDisplay = running ? task.todayTimeSeconds + elapsedSeconds : task.todayTimeSeconds;
  const totalDisplay = running ? task.totalTimeSeconds + elapsedSeconds : task.totalTimeSeconds;

  const hasNotes = (task.notes ?? '').length > 0;

  // Show scroll sentinel for auto-loading (first 3 batches), then "Load more" link
  const showScrollSentinel = timeEntriesHasMore && timeEntryLoadCount < AUTO_LOAD_MAX_BATCHES && !isLoadingEntries;
  const showLoadMoreLink = timeEntriesHasMore && timeEntryLoadCount >= AUTO_LOAD_MAX_BATCHES && !isLoadingEntries;

  return (
    <div className="task-detail">
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
            <h2 className="task-detail__title" onClick={() => setEditingTitle(true)}>
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
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="task-detail__field">
              <label>Source</label>
              <span className="task-detail__source-badge">{task.source}</span>
              {task.externalId && (
                <span className="task-detail__external-id">#{task.externalId}</span>
              )}
            </div>

            <div className="task-detail__field">
              <label>Description</label>
              <textarea
                rows={4}
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                onBlur={handleSaveDesc}
                placeholder="Add a description..."
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
              />
              <div className="task-detail__comment-actions">
                <label className="task-detail__sync-toggle">
                  <input
                    type="checkbox"
                    checked={commentSyncable}
                    onChange={(e) => setCommentSyncable(e.target.checked)}
                  />
                  Sync to source
                </label>
                <button className="task-detail__comment-submit" onClick={handleAddComment}>
                  Add Comment
                </button>
              </div>
            </div>

            {comments.length === 0 && (
              <p className="task-detail__empty">No comments yet.</p>
            )}
            {comments.map((comment) => (
              <div key={comment.id} className="comment">
                <div className="comment__header">
                  <span className="comment__date">
                    {new Date(comment.createdAt).toLocaleString()}
                  </span>
                  <div className="comment__badges">
                    {comment.syncable ? (
                      <span className={`comment__sync-badge ${comment.synced ? 'comment__sync-badge--synced' : ''}`}>
                        {comment.synced ? 'synced' : 'will sync'}
                      </span>
                    ) : (
                      <span className="comment__sync-badge comment__sync-badge--local">local only</span>
                    )}
                    <button
                      className="comment__delete"
                      onClick={() => handleDeleteComment(comment.id)}
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <p className="comment__body">{comment.body}</p>
              </div>
            ))}
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
              placeholder="Add notes..."
            />
            <div className="task-detail__notes-hint">
              Notes auto-save when you click away.
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
    </div>
  );
}
