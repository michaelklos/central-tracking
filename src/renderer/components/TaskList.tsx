import React, { useState, useMemo, useRef } from 'react';
import { useTaskContext, SECTION_STATUSES } from '../context/TaskContext';
import { useTimerContext, useElapsedSeconds } from '../context/TimerContext';
import { usePluginCapabilities, shouldShowReportedFor } from '../hooks/usePluginCapabilities';
import { formatDuration } from '../utils/time';
import { SplitButton } from './SplitButton';
import { ConfirmDialog } from './ConfirmDialog';
import { TaskContextMenu, type TaskContextMenuTarget } from './TaskContextMenu';
import type { Task, TaskStatus, TaskSource, TaskSortBy } from '../../shared/types';
import './TaskList.css';

const STATUS_LABELS: Record<TaskStatus, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'done': 'Done',
  'blocked': 'Blocked',
};

const SOURCE_LABELS: Record<TaskSource, string> = {
  'ad-hoc': 'Ad Hoc',
  'email': 'Email',
  'meeting-prep': 'Meeting Prep',
  'plugin': 'Plugin',
};

type GroupBy = 'none' | 'status' | 'source';

/** A rendered group header plus the rows and paging state under it. */
interface ListSection {
  /** Header label; doubles as the collapse key and the load-more label. */
  key: string;
  tasks: Task[];
  /** Shown in the pill — the section's overall count, not the loaded rows. */
  count: number;
  hasMore: boolean;
  loadMore?: () => Promise<void>;
  isDone: boolean;
}

const COLLAPSED_GROUPS_KEY = 'ct-collapsed-groups';

/**
 * Today's time for the row whose timer is running. Only this component
 * subscribes to the tick, and it is only mounted for the running task, so a
 * running timer re-renders exactly one cell each second — not the row's
 * siblings, and not TaskList itself.
 */
function RunningTaskTime({ baseSeconds }: { baseSeconds: number }) {
  const elapsedSeconds = useElapsedSeconds();
  return <>{formatDuration(baseSeconds + elapsedSeconds)}</>;
}

export function TaskList() {
  const {
    activeTasks,
    activeTasksTotal,
    activeTasksHasMore,
    statusSections,
    loadMoreStatusTasks,
    doneTasks,
    doneTasksTotal,
    doneTasksHasMore,
    doneTasksLoaded,
    deletedTasks,
    deletedTasksTotal,
    deletedTasksHasMore,
    deletedTasksLoaded,
    batchMode,
    selectedTaskIds,
    toggleTaskSelection,
    selectAllTasks,
    deselectAllTasks,
    selectAllActiveTasks,
    selectedTaskId,
    selectTask,
    createTask,
    updateTask,
    reorderTasks,
    loadMoreActiveTasks,
    loadDoneTasks,
    loadMoreDoneTasks,
    loadDeletedTasks,
    loadMoreDeletedTasks,
    restoreTask,
    purgeTask,
    emptyRecycleBin,
    restoreAllDeleted,
    categories,
    sortBy,
    setSortBy,
  } = useTaskContext();
  const { startTimer, stopTimer, isRunningForTask } = useTimerContext();
  const pluginCaps = usePluginCapabilities();
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addAsTodo, setAddAsTodo] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const newTaskInputRef = useRef<HTMLInputElement>(null);
  // Which groups are collapsed, persisted like the rest of the UI state so
  // the list looks the same next launch.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch { /* ignore */ }
    return new Set(['Done']);
  });
  const [loadingDone, setLoadingDone] = useState(false);
  const [loadingMoreActive, setLoadingMoreActive] = useState(false);
  // Which section's "load more" is in flight, by section key.
  const [loadingMoreSection, setLoadingMoreSection] = useState<string | null>(null);
  const [recycleBinCollapsed, setRecycleBinCollapsed] = useState(true);
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [loadingMoreDeleted, setLoadingMoreDeleted] = useState(false);
  const [emptyBinConfirm, setEmptyBinConfirm] = useState(false);
  const [restoreAllConfirm, setRestoreAllConfirm] = useState(false);
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<TaskContextMenuTarget | null>(null);
  const dragItemRef = useRef<string | null>(null);
  const dragOverRef = useRef<string | null>(null);

  // For non-grouped and source-grouped views, combine active + done.
  // Filtering is server-side, so the loaded pages are used as they come back.
  const allFilteredTasks = useMemo(
    () => [...activeTasks, ...doneTasks],
    [activeTasks, doneTasks]
  );

  // Each rendered section: its rows, the pill count (the status total from
  // the server, not just what is loaded), and how to page it.
  const sections = useMemo<ListSection[]>(() => {
    if (groupBy === 'status') {
      const out: ListSection[] = SECTION_STATUSES
        .map((status) => ({ status, section: statusSections[status] }))
        // To Do keeps its header when empty — it is where a new task lands
        // and where the user goes looking. The rest earn theirs.
        .filter(({ status, section }) => status === 'todo' || (section?.total ?? 0) > 0)
        .map(({ status, section }) => ({
          key: STATUS_LABELS[status],
          tasks: section?.items ?? [],
          count: section?.total ?? 0,
          hasMore: section?.hasMore ?? false,
          loadMore: () => loadMoreStatusTasks(status),
          isDone: false,
        }));
      out.push({
        key: 'Done',
        tasks: doneTasks,
        count: doneTasksTotal,
        hasMore: doneTasksHasMore,
        loadMore: loadMoreDoneTasks,
        isDone: true,
      });
      return out;
    }

    if (groupBy === 'none') {
      return [{ key: 'All Tasks', tasks: allFilteredTasks, count: allFilteredTasks.length, hasMore: false, isDone: false }];
    }

    // Source grouping — use combined tasks. There is no per-source total to
    // ask the server for, so the pill counts what is loaded.
    const groups: Record<string, Task[]> = {};
    for (const task of allFilteredTasks) {
      const key = SOURCE_LABELS[task.source] ?? task.source;
      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    }
    return Object.entries(groups).map(([key, tasks]) => ({
      key, tasks, count: tasks.length, hasMore: false, isDone: false,
    }));
  }, [statusSections, doneTasks, doneTasksTotal, doneTasksHasMore, loadMoreStatusTasks, loadMoreDoneTasks, allFilteredTasks, groupBy]);

  const toggleGroupCollapse = async (group: string) => {
    const willExpand = collapsedGroups.has(group);

    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
      } catch { /* ignore */ }
      return next;
    });

    // Trigger loading done tasks when Done group is expanded for the first time
    if (willExpand && group === 'Done' && !doneTasksLoaded) {
      setLoadingDone(true);
      await loadDoneTasks();
      setLoadingDone(false);
    }
  };

  const handleCreateTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    if (addAsTodo) {
      const task = await createTask({ title });
      selectTask(task.id);
    } else {
      const task = await createTask({ title, status: 'in-progress' });
      selectTask(task.id);
      await startTimer(task.id);
    }
    setNewTaskTitle('');
    newTaskInputRef.current?.focus();
  };

  // Switches to sticky To-Do mode; if text is present also adds that task
  const handleSelectAddAsTodo = async () => {
    setAddAsTodo(true);
    const title = newTaskTitle.trim();
    if (title) {
      const task = await createTask({ title });
      selectTask(task.id);
      setNewTaskTitle('');
    }
    newTaskInputRef.current?.focus();
  };

  // Switches back to Add & Start Timer mode; if text is present also adds that task
  const handleSelectAddWithTimer = async () => {
    setAddAsTodo(false);
    const title = newTaskTitle.trim();
    if (title) {
      const task = await createTask({ title, status: 'in-progress' });
      selectTask(task.id);
      await startTimer(task.id);
      setNewTaskTitle('');
    }
    newTaskInputRef.current?.focus();
  };

  const handleDragStart = (taskId: string) => {
    dragItemRef.current = taskId;
  };

  const handleDragOver = (e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    dragOverRef.current = taskId;
  };

  const handleDrop = async () => {
    if (!dragItemRef.current || !dragOverRef.current || dragItemRef.current === dragOverRef.current) return;

    const ids = activeTasks.map((t) => t.id);
    const fromIdx = ids.indexOf(dragItemRef.current);
    const toIdx = ids.indexOf(dragOverRef.current);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragItemRef.current);
    await reorderTasks(ids);

    dragItemRef.current = null;
    dragOverRef.current = null;
  };

  const handleTimerToggle = async (taskId: string) => {
    if (isRunningForTask(taskId)) {
      await stopTimer();
    } else {
      await startTimer(taskId);
    }
  };

  const handleMarkDone = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    await updateTask(taskId, { status: 'done' });
  };


  const getCategoryDots = (task: Task) => {
    return task.categoryIds
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean);
  };

  const handleLoadMoreActive = async () => {
    setLoadingMoreActive(true);
    await loadMoreActiveTasks();
    setLoadingMoreActive(false);
  };

  const handleToggleRecycleBin = async () => {
    const willExpand = recycleBinCollapsed;
    setRecycleBinCollapsed(!recycleBinCollapsed);
    if (willExpand && !deletedTasksLoaded) {
      setLoadingDeleted(true);
      await loadDeletedTasks();
      setLoadingDeleted(false);
    }
  };

  const handleLoadMoreDeleted = async () => {
    setLoadingMoreDeleted(true);
    await loadMoreDeletedTasks();
    setLoadingMoreDeleted(false);
  };

  const handleEmptyRecycleBin = async () => {
    setEmptyBinConfirm(false);
    await emptyRecycleBin();
  };

  const handleRestoreAll = async () => {
    setRestoreAllConfirm(false);
    await restoreAllDeleted();
  };

  const handlePurge = async (id: string) => {
    setPurgeConfirmId(null);
    await purgeTask(id);
  };

  const getDaysAgo = (deletedAt: string) => {
    const diff = Date.now() - new Date(deletedAt).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  };

  // All visible task IDs (for Select All). Read off the rendered sections so
  // it matches what is on screen in every grouping mode.
  const allVisibleIds = useMemo(
    () => sections.flatMap((s) => s.tasks.map((t) => t.id)),
    [sections]
  );

  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedTaskIds.has(id));

  const handleSelectAllToggle = () => {
    if (allSelected) {
      deselectAllTasks();
    } else {
      selectAllTasks(allVisibleIds);
    }
  };

  const handleSelectAllActive = async () => {
    await selectAllActiveTasks();
  };

  const handleSectionLoadMore = async (section: ListSection) => {
    if (!section.loadMore) return;
    setLoadingMoreSection(section.key);
    await section.loadMore();
    setLoadingMoreSection(null);
  };

  const totalVisible = allVisibleIds.length;

  return (
    <div className="task-list">
      <div className="task-list__toolbar">
        {batchMode ? (
          <div className="task-list__batch-header">
            <label className="task-list__select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={handleSelectAllToggle}
              />
              <span>Select All</span>
            </label>
            <span className="task-list__select-count">
              {selectedTaskIds.size} of {activeTasksTotal} selected
            </span>
            {activeTasksHasMore && selectedTaskIds.size < activeTasksTotal && (
              <button
                className="task-list__select-all-btn"
                onClick={handleSelectAllActive}
              >
                Select all {activeTasksTotal}
              </button>
            )}
          </div>
        ) : (
          <div className="task-list__add">
            <input
              ref={newTaskInputRef}
              type="text"
              placeholder="Add a new task..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTask()}
            />
            <SplitButton
              primaryLabel={addAsTodo ? 'Add as To-Do' : 'Add'}
              primaryAction={handleCreateTask}
              alternatives={addAsTodo
                ? [{ label: 'Add & Start Timer', action: handleSelectAddWithTimer }]
                : [{ label: 'Add as To-Do', action: handleSelectAddAsTodo }]
              }
            />
          </div>
        )}
        <div className="task-list__sort-by">
          <label>Sort:</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as TaskSortBy)}>
            <option value="manual">Manual</option>
            <option value="recent">Recent</option>
            <option value="created">Created</option>
            <option value="alphabetical">A-Z</option>
            <option value="most-time-today">Most Time Today</option>
          </select>
        </div>
        <div className="task-list__group-by">
          <label>Group:</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="none">None</option>
            <option value="status">Status</option>
            <option value="source">Source</option>
          </select>
        </div>
      </div>

      <div className="task-list__body">
        {sections.map((section) => {
          const group = section.key;
          const groupTasks = section.tasks;
          const isCollapsed = collapsedGroups.has(group);
          const isDoneGroup = section.isDone;
          return (
            <div key={group} className="task-list__group">
              {groupBy !== 'none' && (
                <h3
                  className={`task-list__group-header ${isCollapsed ? 'task-list__group-header--collapsed' : ''}`}
                  onClick={() => toggleGroupCollapse(group)}
                >
                  <span className="task-list__group-chevron">{isCollapsed ? '▸' : '▾'}</span>
                  {group}
                  <span className="task-list__group-count">{section.count}</span>
                </h3>
              )}
              {!isCollapsed && (
                <>
                  {isDoneGroup && loadingDone && (
                    <div className="task-list__loading">Loading...</div>
                  )}
                  {groupTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`task-item ${selectedTaskId === task.id ? 'task-item--selected' : ''} ${
                        isRunningForTask(task.id) ? 'task-item--timing' : ''
                      } ${batchMode && selectedTaskIds.has(task.id) ? 'task-item--batch-selected' : ''}`}
                      onClick={() => batchMode ? toggleTaskSelection(task.id) : selectTask(task.id)}
                      onContextMenu={(e) => {
                        if (batchMode) return;
                        e.preventDefault();
                        setContextMenu({ task, x: e.clientX, y: e.clientY });
                      }}
                      draggable={!batchMode && sortBy === 'manual'}
                      onDragStart={() => handleDragStart(task.id)}
                      onDragOver={(e) => handleDragOver(e, task.id)}
                      onDrop={handleDrop}
                    >
                      <div className="task-item__left">
                        {batchMode && (
                          <span className={`task-item__select-circle ${selectedTaskIds.has(task.id) ? 'task-item__select-circle--selected' : ''}`}>
                            {selectedTaskIds.has(task.id) ? '\u25CF' : '\u25CB'}
                          </span>
                        )}
                        <button
                          className={`task-item__timer-btn ${isRunningForTask(task.id) ? 'task-item__timer-btn--active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTimerToggle(task.id);
                          }}
                          title={isRunningForTask(task.id) ? 'Stop timer' : 'Start timer'}
                        >
                          {isRunningForTask(task.id) ? '■' : '▶'}
                        </button>
                        <div className="task-item__info">
                          <span className="task-item__title">{task.title}</span>
                          <div className="task-item__meta">
                            <span className={`task-item__status task-item__status--${task.status}`}>
                              {STATUS_LABELS[task.status]}
                            </span>
                            {getCategoryDots(task).map((cat) => (
                              <span
                                key={cat!.id}
                                className="task-item__cat-badge"
                                style={{ background: cat!.color }}
                              >
                                {cat!.name}
                              </span>
                            ))}
                            {(task.notes ?? '').length > 0 && (
                              <span className="task-item__notes-badge" title="Has notes">&#128221;</span>
                            )}
                            {task.totalTimeSeconds > 0 && shouldShowReportedFor(task.pluginId, pluginCaps) && (
                              task.hasUnreportedTime ? (
                                <span
                                  className="task-item__report-chip task-item__report-chip--pending"
                                  title={`${formatDuration(task.unreportedTimeSeconds)} not yet reported`}
                                >
                                  ⚠
                                </span>
                              ) : (
                                <span
                                  className="task-item__report-chip task-item__report-chip--done"
                                  title="All time entries reported"
                                >
                                  ✓
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="task-item__right">
                        <span className="task-item__time">
                          {isRunningForTask(task.id)
                            ? <RunningTaskTime baseSeconds={task.todayTimeSeconds} />
                            : formatDuration(task.todayTimeSeconds)}
                        </span>
                        {task.status !== 'done' && !batchMode && (
                          <button
                            className="task-item__check-btn"
                            onClick={(e) => handleMarkDone(e, task.id)}
                            title="Mark as done"
                          >
                            &#10003;
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {/* Each section pages on its own, up to the per-section limit */}
                  {section.hasMore && section.loadMore && (
                    loadingMoreSection === group ? (
                      <div className="task-list__loading">Loading...</div>
                    ) : (
                      <button
                        className="task-list__load-more"
                        onClick={() => handleSectionLoadMore(section)}
                      >
                        Load more {group}
                      </button>
                    )
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* Load more for active tasks — status grouping pages per section */}
        {groupBy !== 'status' && activeTasksHasMore && (
          <button
            className="task-list__load-more"
            onClick={handleLoadMoreActive}
            disabled={loadingMoreActive}
          >
            {loadingMoreActive ? 'Loading...' : 'Load more tasks...'}
          </button>
        )}

        {totalVisible === 0 && (
          <div className="task-list__empty">
            No tasks found. Create one above or adjust your filters.
          </div>
        )}

        {/* Recycle Bin */}
        {deletedTasksTotal > 0 && (
          <div className="task-list__group task-list__recycle-bin">
            <h3
              className={`task-list__group-header task-list__group-header--recycle ${recycleBinCollapsed ? 'task-list__group-header--collapsed' : ''}`}
              onClick={handleToggleRecycleBin}
            >
              <span className="task-list__group-chevron">{recycleBinCollapsed ? '\u25B8' : '\u25BE'}</span>
              Recycle Bin
              <span className="task-list__group-count">{deletedTasksTotal}</span>
            </h3>
            {!recycleBinCollapsed && (
              <>
                {loadingDeleted && (
                  <div className="task-list__loading">Loading...</div>
                )}
                {deletedTasks.map((task) => (
                  <div key={task.id} className="task-item task-item--deleted">
                    <div className="task-item__left">
                      <div className="task-item__info">
                        <span className="task-item__title task-item__title--deleted">{task.title}</span>
                        <span className="task-item__deleted-ago">
                          deleted {task.deletedAt ? getDaysAgo(task.deletedAt) : ''}
                        </span>
                      </div>
                    </div>
                    <div className="task-item__right">
                      <button
                        className="task-item__restore-btn"
                        onClick={() => restoreTask(task.id)}
                        title="Restore task"
                      >
                        Restore
                      </button>
                      <button
                        className="task-item__purge-btn"
                        onClick={() => setPurgeConfirmId(task.id)}
                        title="Permanently delete"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
                {deletedTasksHasMore && !loadingMoreDeleted && (
                  <button className="task-list__load-more" onClick={handleLoadMoreDeleted}>
                    Load more deleted tasks...
                  </button>
                )}
                {loadingMoreDeleted && (
                  <div className="task-list__loading">Loading...</div>
                )}
                {deletedTasks.length > 0 && (
                  <div className="task-list__bin-actions">
                    <button
                      className="task-list__restore-all-btn"
                      onClick={() => setRestoreAllConfirm(true)}
                    >
                      Restore All
                    </button>
                    <button
                      className="task-list__empty-bin"
                      onClick={() => setEmptyBinConfirm(true)}
                    >
                      Empty Recycle Bin
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {restoreAllConfirm && (
        <ConfirmDialog
          title="Restore All"
          message={`Restore all ${deletedTasksTotal} task${deletedTasksTotal !== 1 ? 's' : ''} from the recycle bin?`}
          confirmLabel="Restore All"
          onConfirm={handleRestoreAll}
          onCancel={() => setRestoreAllConfirm(false)}
        />
      )}

      {emptyBinConfirm && (
        <ConfirmDialog
          title="Empty Recycle Bin"
          message={`Permanently delete all ${deletedTasksTotal} task${deletedTasksTotal !== 1 ? 's' : ''} in the recycle bin? This cannot be undone.`}
          confirmLabel="Empty Bin"
          variant="danger"
          onConfirm={handleEmptyRecycleBin}
          onCancel={() => setEmptyBinConfirm(false)}
        />
      )}

      {purgeConfirmId && (
        <ConfirmDialog
          title="Permanently Delete"
          message="Permanently delete this task? This cannot be undone."
          confirmLabel="Delete Forever"
          variant="danger"
          onConfirm={() => handlePurge(purgeConfirmId)}
          onCancel={() => setPurgeConfirmId(null)}
        />
      )}

      {contextMenu && (
        <TaskContextMenu target={contextMenu} onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
}
