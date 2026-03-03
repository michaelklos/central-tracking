import React, { useState, useMemo, useRef } from 'react';
import { useTaskContext } from '../context/TaskContext';
import { useTimerContext } from '../context/TimerContext';
import { formatDuration } from '../utils/time';
import { SplitButton } from './SplitButton';
import type { Task, TaskStatus, TaskSource } from '../../shared/types';
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

// Sort order for status groups — "Done" last
const STATUS_ORDER: Record<string, number> = {
  'To Do': 0,
  'In Progress': 1,
  'Blocked': 2,
  'Done': 3,
};

type GroupBy = 'none' | 'status' | 'source';

export function TaskList() {
  const {
    activeTasks,
    activeTasksHasMore,
    doneTasks,
    doneTasksTotal,
    doneTasksHasMore,
    doneTasksLoaded,
    filter,
    selectedTaskId,
    selectTask,
    createTask,
    updateTask,
    reorderTasks,
    loadMoreActiveTasks,
    loadDoneTasks,
    loadMoreDoneTasks,
    categories,
  } = useTaskContext();
  const { startTimer, stopTimer, isRunningForTask, elapsedSeconds } = useTimerContext();
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['Done']));
  const [loadingDone, setLoadingDone] = useState(false);
  const [loadingMoreActive, setLoadingMoreActive] = useState(false);
  const [loadingMoreDone, setLoadingMoreDone] = useState(false);
  const dragItemRef = useRef<string | null>(null);
  const dragOverRef = useRef<string | null>(null);

  // Apply filters to active tasks
  const applyFilter = (task: Task) => {
    if (filter.status && task.status !== filter.status) return false;
    if (filter.source && task.source !== filter.source) return false;
    if (filter.categoryId && !task.categoryIds.includes(filter.categoryId)) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (!task.title.toLowerCase().includes(q) && !task.description.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  };

  const filteredActiveTasks = useMemo(() => activeTasks.filter(applyFilter), [activeTasks, filter]);
  const filteredDoneTasks = useMemo(() => doneTasks.filter(applyFilter), [doneTasks, filter]);

  // For non-grouped and source-grouped views, combine active + done
  const allFilteredTasks = useMemo(
    () => [...filteredActiveTasks, ...filteredDoneTasks],
    [filteredActiveTasks, filteredDoneTasks]
  );

  // Group tasks — special handling for status grouping
  const groupedTasks = useMemo(() => {
    if (groupBy === 'status') {
      // Build groups from active tasks (non-done statuses)
      const groups: Record<string, Task[]> = {};
      for (const task of filteredActiveTasks) {
        const key = STATUS_LABELS[task.status] ?? task.status;
        if (!groups[key]) groups[key] = [];
        groups[key].push(task);
      }
      // Always add a Done group (even if empty, so the header shows)
      groups['Done'] = filteredDoneTasks;

      // Sort group keys so "Done" is last
      const sortedEntries = Object.entries(groups).sort(
        ([a], [b]) => (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99)
      );
      const sorted: Record<string, Task[]> = {};
      for (const [key, val] of sortedEntries) {
        sorted[key] = val;
      }
      return sorted;
    }

    if (groupBy === 'none') return { 'All Tasks': allFilteredTasks };

    // Source grouping — use combined tasks
    const groups: Record<string, Task[]> = {};
    for (const task of allFilteredTasks) {
      const key = SOURCE_LABELS[task.source] ?? task.source;
      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    }
    return groups;
  }, [filteredActiveTasks, filteredDoneTasks, allFilteredTasks, groupBy]);

  const toggleGroupCollapse = async (group: string) => {
    const willExpand = collapsedGroups.has(group);

    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
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
    const task = await createTask({ title });
    await startTimer(task.id);
    setNewTaskTitle('');
  };

  const handleCreateTaskOnly = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    await createTask({ title });
    setNewTaskTitle('');
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

    const ids = filteredActiveTasks.map((t) => t.id);
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

  const getTaskTimeDisplay = (task: Task) => {
    const running = isRunningForTask(task.id);
    const todaySeconds = running ? task.todayTimeSeconds + elapsedSeconds : task.todayTimeSeconds;
    return formatDuration(todaySeconds);
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

  const handleLoadMoreDone = async () => {
    setLoadingMoreDone(true);
    await loadMoreDoneTasks();
    setLoadingMoreDone(false);
  };

  // Determine the count to show on the Done group header
  const getDoneGroupCount = (group: string) => {
    if (group === 'Done' && groupBy === 'status') {
      return doneTasksTotal;
    }
    return undefined;
  };

  const totalVisible = filteredActiveTasks.length + filteredDoneTasks.length;

  return (
    <div className="task-list">
      <div className="task-list__toolbar">
        <div className="task-list__add">
          <input
            type="text"
            placeholder="Add a new task..."
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateTask()}
          />
          <SplitButton
            primaryLabel="Add"
            primaryAction={handleCreateTask}
            alternatives={[{ label: 'Add as To-Do', action: handleCreateTaskOnly }]}
          />
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
        {Object.entries(groupedTasks).map(([group, groupTasks]) => {
          const isCollapsed = collapsedGroups.has(group);
          const doneCount = getDoneGroupCount(group);
          const isDoneGroup = group === 'Done' && groupBy === 'status';
          return (
            <div key={group} className="task-list__group">
              {groupBy !== 'none' && (
                <h3
                  className={`task-list__group-header ${isCollapsed ? 'task-list__group-header--collapsed' : ''}`}
                  onClick={() => toggleGroupCollapse(group)}
                >
                  <span className="task-list__group-chevron">{isCollapsed ? '▸' : '▾'}</span>
                  {group}
                  <span className="task-list__group-count">
                    {doneCount !== undefined ? doneCount : groupTasks.length}
                  </span>
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
                      }`}
                      onClick={() => selectTask(task.id)}
                      draggable
                      onDragStart={() => handleDragStart(task.id)}
                      onDragOver={(e) => handleDragOver(e, task.id)}
                      onDrop={handleDrop}
                    >
                      <div className="task-item__left">
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
                          </div>
                        </div>
                      </div>
                      <div className="task-item__right">
                        <span className="task-item__time">{getTaskTimeDisplay(task)}</span>
                        {task.status !== 'done' && (
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
                  {/* Load more for done tasks */}
                  {isDoneGroup && doneTasksHasMore && !loadingMoreDone && (
                    <button className="task-list__load-more" onClick={handleLoadMoreDone}>
                      Load more done tasks...
                    </button>
                  )}
                  {isDoneGroup && loadingMoreDone && (
                    <div className="task-list__loading">Loading...</div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* Load more for active tasks (non-grouped or non-status views) */}
        {activeTasksHasMore && (
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
      </div>
    </div>
  );
}
