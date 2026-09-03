/**
 * ADO status transition rules — the single host-side source of truth, used by
 * the main process (`taskHandlers.updateTask`) and the renderer (status
 * dropdown in `TaskDetail`).
 *
 * `blocked` is a local-only state with no ADO mapping: the user can set it,
 * and the plugin skips pushing it, so transitions to and from it are allowed
 * locally and become a no-op on the next push.
 *
 * The ADO plugin keeps its own copy in `plugins/ado/src/push-state.ts`. It is
 * a separate esbuild-bundled workspace with `rootDir: src` and cannot import
 * from here; that copy must be changed alongside this one.
 */
import type { TaskStatus } from './types';

const ADO_FORWARD_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlyArray<TaskStatus>>> = {
  todo: ['in-progress', 'done', 'blocked'],
  'in-progress': ['done', 'blocked'],
  done: ['in-progress', 'blocked'],
  blocked: ['todo', 'in-progress', 'done'],
};

/** Whether an ADO-source task may move from `from` to `to`. */
export function isAllowedAdoTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return (ADO_FORWARD_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * For ADO-source tasks, the statuses the user may switch to from `current`
 * (always includes `current` itself so the dropdown can render its own value).
 */
export function allowedAdoStatusTargets(current: TaskStatus): TaskStatus[] {
  return [current, ...(ADO_FORWARD_TRANSITIONS[current] ?? [])];
}

/** Reopens (done → in-progress) — ADO may reject; surface a warning. */
export function isAdoReopen(from: TaskStatus, to: TaskStatus): boolean {
  return from === 'done' && to === 'in-progress';
}
