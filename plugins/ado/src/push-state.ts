/**
 * Push ct status changes → ADO `System.State`.
 *
 * Per task with `source='ado' AND state_dirty=1`:
 *   1. FSM-validate the transition (defense in depth — backend also rejects).
 *      A ct status of `blocked` has no ADO mapping: log + skip. The task
 *      stays `state_dirty=1` so the next status change that DOES map will
 *      retrigger the push (no cleanup needed).
 *   2. Fetch current ADO work item for `rev`.
 *   3. PATCH with `test`/`replace` ops so concurrent edits surface as 409.
 *   4. On 200: clear `state_dirty` and update `external_state` via
 *      `setExternalTaskState`. Must propagate failures — otherwise next pull
 *      sees ADO has the new state, ct still says dirty + old external_state,
 *      and reverts.
 *   5. On 409: refetch + retry once.
 *   6. On 400 (workflow rule): log a workflow-rejection warning, leave the
 *      task dirty (user must resolve in ADO or adjust the local target).
 *   7. On other errors: log, leave dirty.
 */
import { AdoClient } from './ado-client';
import type { AdoConfig } from './config';
import { CtClient } from './ct-client';
import { describeError, isConflict, isWorkflowRejection } from './lib/ado-errors';
import { forwardStateMap, inverseStateMap } from './state-map';
import type { CtTask, CtTaskStatus, JsonPatchOp } from './types';

export interface PushStateResult {
  considered: number;
  pushed: number;
  skippedBlocked: number;
  rejectedByWorkflow: number;
  failed: number;
  warnings: string[];
}

const STATE_FIELD = 'System.State';

/**
 * Allowed local-side ADO transitions. Mirrors the backend FSM in
 * `taskHandlers.ts:isAllowedAdoTransition`. Kept in sync; if you change
 * one, change the other.
 */
const ALLOWED: Readonly<Record<CtTaskStatus, ReadonlyArray<CtTaskStatus>>> = {
  todo: ['in-progress', 'done', 'blocked'],
  'in-progress': ['done', 'blocked'],
  done: ['in-progress', 'blocked'],
  blocked: ['todo', 'in-progress', 'done'],
};

function isAllowed(from: CtTaskStatus, to: CtTaskStatus): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}

function buildPatch(rev: number, newState: string): JsonPatchOp[] {
  return [
    { op: 'test', path: '/rev', value: rev },
    { op: 'add', path: `/fields/${STATE_FIELD}`, value: newState },
  ];
}

type Outcome = 'pushed' | 'skipped-blocked' | 'rejected-workflow' | 'failed';

async function pushOneTask(
  ado: AdoClient,
  ct: CtClient,
  task: CtTask,
  config: AdoConfig,
  warnings: string[],
): Promise<Outcome> {
  if (!task.externalId) {
    warnings.push(`[ado] push-state: task ${task.id} has no external_id, skipping`);
    return 'failed';
  }
  const workItemId = Number(task.externalId);
  if (!Number.isFinite(workItemId)) {
    warnings.push(`[ado] push-state: task ${task.id} external_id "${task.externalId}" not numeric, skipping`);
    return 'failed';
  }

  // blocked has no ADO mapping — leave state_dirty=1 so a later mapped
  // transition retriggers. No cleanup needed: the flag is idempotent.
  if (task.status === 'blocked') {
    warnings.push(
      `[ado] push-state: #${task.externalId} ct status is "blocked" (no ADO mapping), skipping`,
    );
    return 'skipped-blocked';
  }

  // Defense in depth: re-check the inferred prior status maps to the new
  // one. Backend already validated at update time; this catches the rare
  // case where ADO changed underneath us (external_state was repulled
  // between the user's edit and this push) — easier to bail than to PATCH
  // and let ADO reject with a workflow error.
  const inferredFrom = task.externalState
    ? inverseStateMap(config, task.externalState)
    : null;
  if (inferredFrom && !isAllowed(inferredFrom, task.status)) {
    warnings.push(
      `[ado] push-state: #${task.externalId} prior ADO state "${task.externalState}" → ct "${task.status}" not an allowed transition, skipping`,
    );
    return 'failed';
  }

  const mapped = forwardStateMap(config, task.status);
  if (!mapped) {
    warnings.push(
      `[ado] push-state: #${task.externalId} no ADO state mapped for ct status "${task.status}", skipping`,
    );
    return 'failed';
  }

  let patchOk = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && !patchOk; attempt++) {
    const wi = await ado.getWorkItem(workItemId, ['System.Id', STATE_FIELD]);
    try {
      await ado.patchWorkItem(workItemId, buildPatch(wi.rev, mapped));
      patchOk = true;
    } catch (err) {
      lastErr = err;
      if (isConflict(err) && attempt === 0) continue;
      if (isWorkflowRejection(err)) {
        warnings.push(
          `[ado] push-state: #${task.externalId} ADO rejected transition (${task.externalState ?? '?'} → ${mapped}): ${describeError(err)}`,
        );
        return 'rejected-workflow';
      }
      warnings.push(
        `[ado] push-state: #${task.externalId} PATCH failed: ${describeError(err)}`,
      );
      return 'failed';
    }
  }
  if (!patchOk) {
    warnings.push(
      `[ado] push-state: #${task.externalId} PATCH failed after retry: ${describeError(lastErr)}`,
    );
    return 'failed';
  }

  // Bookkeeping after a successful PATCH MUST propagate failures; otherwise
  // ADO has the new state but ct keeps state_dirty=1 and the old
  // external_state, and the next pull reads "drift" and reverts ct.
  await ct.setExternalTaskState(task.id, mapped);
  return 'pushed';
}

export async function pushState(
  ado: AdoClient,
  ct: CtClient,
  config: AdoConfig,
): Promise<PushStateResult> {
  const warnings: string[] = [];
  const tasks = await ct.getTasks({ source: ['ado'], stateDirty: true });

  let pushed = 0;
  let skippedBlocked = 0;
  let rejectedByWorkflow = 0;
  let failed = 0;
  for (const task of tasks) {
    const out = await pushOneTask(ado, ct, task, config, warnings);
    switch (out) {
      case 'pushed': pushed++; break;
      case 'skipped-blocked': skippedBlocked++; break;
      case 'rejected-workflow': rejectedByWorkflow++; break;
      case 'failed': failed++; break;
    }
  }

  return {
    considered: tasks.length,
    pushed,
    skippedBlocked,
    rejectedByWorkflow,
    failed,
    warnings,
  };
}

export const _internals = { buildPatch, isAllowed, STATE_FIELD };
