import React, { useState, useMemo, useRef } from 'react';
import { useTaskContext } from '../context/TaskContext';
import { useTimerContext } from '../context/TimerContext';
import { formatDuration } from '../utils/time';
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

type GroupBy = 'none' | 'status' | 'source';

export function TaskList() {
  const { tasks, filter, selectedTaskId, selectTask, createTask, reorderTasks, categories } = useTaskContext();
  const { startTimer, stopTimer, isRunningForTask, elapsedSeconds, activeEntry } = useTimerContext();
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const dragItemRef = useRef<string | null>(null);
  const dragOverRef = useRef<string | null>(null);

  // Apply filters
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
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
    });
  }, [tasks, filter]);

  // Group tasks
  const groupedTasks = useMemo(() => {
    if (groupBy === 'none') return { 'All Tasks': filteredTasks };

    const groups: Record<string, Task[]> = {};
    for (const task of filteredTasks) {
      const key =
        groupBy === 'status'
          ? STATUS_LABELS[task.status] ?? task.status
          : SOURCE_LABELS[task.source] ?? task.source;
      if (!groups[key]) groups[key] = [];
      groups[key].push(task);
    }
    return groups;
  }, [filteredTasks, groupBy]);

  const handleCreateTask = async () => {
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

    const ids = filteredTasks.map((t) => t.id);
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
          <button className="task-list__add-btn" onClick={handleCreateTask}>
            Add
          </button>
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
        {Object.entries(groupedTasks).map(([group, groupTasks]) => (
          <div key={group} className="task-list__group">
            {groupBy !== 'none' && (
              <h3 className="task-list__group-header">
                {group}
                <span className="task-list__group-count">{groupTasks.length}</span>
              </h3>
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
                    </div>
                  </div>
                </div>
                <div className="task-item__right">
                  <span className="task-item__time">{getTaskTimeDisplay(task)}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
        {filteredTasks.length === 0 && (
          <div className="task-list__empty">
            No tasks found. Create one above or adjust your filters.
          </div>
        )}
      </div>
    </div>
  );
}
