/**
 * Renderer-side FSM for ADO-source tasks. Mirrors the backend rules in
 * `src/main/ipc/taskHandlers.ts:ADO_FORWARD_TRANSITIONS` and the plugin's
 * `plugins/ado/src/push-state.ts:ALLOWED`. Three copies — if you change
 * one, change them all.
 *
 * `blocked` is included as a local-only target/source: the plugin skips
 * pushing it (no ADO mapping), but the user can still set it locally.
 */
import type { TaskStatus } from '../../shared/types';

const ADO_FORWARD: Readonly<Record<TaskStatus, ReadonlyArray<TaskStatus>>> = {
  todo: ['in-progress', 'done', 'blocked'],
  'in-progress': ['done', 'blocked'],
  done: ['in-progress', 'blocked'],
  blocked: ['todo', 'in-progress', 'done'],
};

/**
 * For ADO-source tasks, return the statuses the user is allowed to switch
 * to from `current` (always includes `current` itself so the dropdown can
 * render the existing value).
 */
export function allowedAdoStatusTargets(current: TaskStatus): TaskStatus[] {
  return [current, ...(ADO_FORWARD[current] ?? [])];
}

/** Reopens (done → in-progress) — ADO may reject; surface a warning. */
export function isAdoReopen(from: TaskStatus, to: TaskStatus): boolean {
  return from === 'done' && to === 'in-progress';
}
