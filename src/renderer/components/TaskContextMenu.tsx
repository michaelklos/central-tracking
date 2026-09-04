import React, { useEffect, useRef, useState } from 'react';
import { useTaskContext } from '../context/TaskContext';
import { allowedAdoStatusTargets } from '../../shared/adoFsm';
import type { Task, TaskStatus } from '../../shared/types';
import './TaskContextMenu.css';

const STATUS_LABELS: Record<TaskStatus, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'done': 'Done',
  'blocked': 'Blocked',
};

const ALL_STATUSES: TaskStatus[] = ['todo', 'in-progress', 'done', 'blocked'];

export interface TaskContextMenuTarget {
  task: Task;
  x: number;
  y: number;
}

/**
 * Right-click menu over a task row: set status, toggle categories, delete.
 * Every action already exists on TaskContext — this is presentation only, so
 * the ADO transition check and `state_dirty` still run in `updateTask`.
 */
export function TaskContextMenu({ target, onClose }: { target: TaskContextMenuTarget; onClose(): void }) {
  const { updateTask, deleteTask, categories } = useTaskContext();
  const { task } = target;
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the menu on screen when the click lands near an edge.
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(target.x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(target.y, window.innerHeight - height - 4)),
    });
  }, [target.x, target.y]);

  // Failures stay on the menu — a rejected ADO transition is the common one,
  // and closing would leave the user with no idea why nothing changed.
  const run = async (what: string, fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`${what}: ${msg}`);
      window.api.log.error(`TaskContextMenu.${what}: ${msg}`);
    }
  };

  const isAdo = task.source === 'plugin' && task.pluginId === 'ado';
  const statuses = isAdo ? allowedAdoStatusTargets(task.status) : ALL_STATUSES;

  const toggleCategory = (catId: string) => {
    const next = task.categoryIds.includes(catId)
      ? task.categoryIds.filter((id) => id !== catId)
      : [...task.categoryIds, catId];
    return run('Failed to change categories', () => updateTask(task.id, { categoryIds: next }));
  };

  return (
    <div
      className="task-context-menu"
      role="menu"
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="task-context-menu__label">Status</div>
      {statuses.map((s) => (
        <button
          key={s}
          role="menuitem"
          className="task-context-menu__item"
          disabled={s === task.status}
          onClick={() => run('Status change rejected', () => updateTask(task.id, { status: s }))}
        >
          <span className="task-context-menu__check">{s === task.status ? '✓' : ''}</span>
          {STATUS_LABELS[s]}
        </button>
      ))}

      {categories.length > 0 && (
        <>
          <div className="task-context-menu__label">Categories</div>
          {categories.map((cat) => (
            <button
              key={cat.id}
              role="menuitem"
              className="task-context-menu__item"
              onClick={() => toggleCategory(cat.id)}
            >
              <span className="task-context-menu__check">
                {task.categoryIds.includes(cat.id) ? '✓' : ''}
              </span>
              <span className="task-context-menu__dot" style={{ background: cat.color }} />
              {cat.name}
            </button>
          ))}
        </>
      )}

      <div className="task-context-menu__sep" />
      <button
        role="menuitem"
        className="task-context-menu__item task-context-menu__item--danger"
        onClick={() => run('Failed to delete task', () => deleteTask(task.id))}
      >
        <span className="task-context-menu__check" />
        Delete
      </button>

      {error && <div className="task-context-menu__error" role="alert">{error}</div>}
    </div>
  );
}
