/**
 * Push ct time entries into ADO `Microsoft.VSTS.Scheduling.CompletedWork`.
 *
 * Per task:
 *   1. Sum unreported entry durations.
 *   2. Round to `round-minutes` per `round-mode` → hours.
 *   3. If rounded == 0: skip (entries stay unreported, accumulate next run).
 *   4. Fetch ADO work item for current `rev` + `CompletedWork`.
 *   5. PATCH with json-patch:
 *        [{op:test, /rev, value:<rev>},
 *         {op:add,  /fields/CompletedWork, value:<current+delta>}]
 *      The `test` op makes the PATCH atomic vs concurrent edits.
 *   6. On 200: mark all unreported entries as reported (now).
 *   7. On 409 (rev mismatch): refetch + retry once. Bypass client retry helper.
 *   8. On any other failure: leave entries unreported, log, continue.
 *
 * No local update of `external_completed_hours` — the next `pull` step in
 * `sync` overwrites it. Eventual consistency is acceptable for display.
 */
import { AdoClient } from './ado-client';
import type { AdoConfig } from './config';
import { CtClient } from './ct-client';
import { describeError, isConflict } from './lib/ado-errors';
import type { CtTask, CtTimeEntry, JsonPatchOp } from './types';

export interface PushedTaskBatch {
  task: CtTask;
  hoursPushed: number;
  entries: CtTimeEntry[];
}

export interface PushTimeResult {
  tasksConsidered: number;
  tasksPushed: number;
  tasksSkippedZero: number;
  tasksFailed: number;
  hoursPushed: number;
  warnings: string[];
  /** One entry per successfully-pushed task; consumed by auto-comment-on-time-push. */
  pushedBatches: PushedTaskBatch[];
}

const SECONDS_PER_HOUR = 3600;
const COMPLETED_WORK_FIELD = 'Microsoft.VSTS.Scheduling.CompletedWork';

export function roundSecondsToHours(
  totalSeconds: number,
  roundMinutes: number,
  mode: 'nearest' | 'up' | 'down',
): number {
  if (totalSeconds <= 0 || roundMinutes <= 0) return 0;
  const bucketSeconds = roundMinutes * 60;
  const ratio = totalSeconds / bucketSeconds;
  let buckets: number;
  switch (mode) {
    case 'up':
      buckets = Math.ceil(ratio);
      break;
    case 'down':
      buckets = Math.floor(ratio);
      break;
    case 'nearest':
    default:
      buckets = Math.round(ratio);
      break;
  }
  return (buckets * bucketSeconds) / SECONDS_PER_HOUR;
}

function sumSeconds(entries: CtTimeEntry[]): number {
  let total = 0;
  for (const e of entries) {
    if (e.durationSeconds != null) total += e.durationSeconds;
  }
  return total;
}

function buildPatch(rev: number, newTotalHours: number): JsonPatchOp[] {
  return [
    { op: 'test', path: '/rev', value: rev },
    { op: 'add', path: `/fields/${COMPLETED_WORK_FIELD}`, value: newTotalHours },
  ];
}

interface TaskOutcome {
  kind: 'pushed' | 'skipped-zero' | 'failed';
  hoursPushed: number;
  entries: CtTimeEntry[];
}

async function pushOneTask(
  ado: AdoClient,
  ct: CtClient,
  task: CtTask,
  config: AdoConfig,
  warnings: string[],
): Promise<TaskOutcome> {
  if (!task.externalId) {
    warnings.push(`[ado] push-time: task ${task.id} has no external_id, skipping`);
    return { kind: 'failed', hoursPushed: 0, entries: [] };
  }
  const workItemId = Number(task.externalId);
  if (!Number.isFinite(workItemId)) {
    warnings.push(`[ado] push-time: task ${task.id} external_id "${task.externalId}" not numeric, skipping`);
    return { kind: 'failed', hoursPushed: 0, entries: [] };
  }

  const entries = await ct.getTimeEntriesByTask(task.id, { unreportedOnly: true });
  if (entries.length === 0) return { kind: 'skipped-zero', hoursPushed: 0, entries: [] };

  const totalSeconds = sumSeconds(entries);
  const deltaHours = roundSecondsToHours(totalSeconds, config.roundMinutes, config.roundMode);
  if (deltaHours === 0) {
    warnings.push(
      `[ado] push-time: #${task.externalId} rounded delta is 0 (${totalSeconds}s, ${config.roundMinutes}m ${config.roundMode}), skipping`,
    );
    return { kind: 'skipped-zero', hoursPushed: 0, entries };
  }

  let patchOk = false;
  for (let attempt = 0; attempt < 2 && !patchOk; attempt++) {
    const wi = await ado.getWorkItem(workItemId, ['System.Id', COMPLETED_WORK_FIELD]);
    const currentHours = (wi.fields[COMPLETED_WORK_FIELD] as number | undefined) ?? 0;
    const newTotal = currentHours + deltaHours;
    try {
      await ado.patchWorkItem(workItemId, buildPatch(wi.rev, newTotal));
      patchOk = true;
    } catch (err) {
      if (isConflict(err) && attempt === 0) continue;
      warnings.push(
        `[ado] push-time: #${task.externalId} PATCH failed: ${describeError(err)}`,
      );
      return { kind: 'failed', hoursPushed: 0, entries: [] };
    }
  }
  if (!patchOk) return { kind: 'failed', hoursPushed: 0, entries: [] };

  // PATCH succeeded — ADO accepted the delta. If markTaskReported fails the
  // next run would double-push, so let the error propagate up to the caller
  // rather than silently swallowing it.
  //
  // When tracksReported is disabled the user owns reported state manually:
  // re-running push-time will re-push the same entries because they remain
  // unreported. That is an explicit choice surfaced in the plugin settings UI.
  if (config.tracksReported) {
    await ct.markTaskReported(task.id, new Date().toISOString());
  }
  return { kind: 'pushed', hoursPushed: deltaHours, entries };
}

export async function pushTime(
  ado: AdoClient,
  ct: CtClient,
  config: AdoConfig,
): Promise<PushTimeResult> {
  const warnings: string[] = [];
  const tasks = await ct.getTasks({ source: ['ado'], hasUnreportedTime: true });

  let tasksPushed = 0;
  let tasksSkippedZero = 0;
  let tasksFailed = 0;
  let hoursPushed = 0;
  const pushedBatches: PushedTaskBatch[] = [];

  for (const task of tasks) {
    const outcome = await pushOneTask(ado, ct, task, config, warnings);
    if (outcome.kind === 'pushed') {
      tasksPushed++;
      hoursPushed += outcome.hoursPushed;
      pushedBatches.push({ task, hoursPushed: outcome.hoursPushed, entries: outcome.entries });
    } else if (outcome.kind === 'skipped-zero') {
      tasksSkippedZero++;
    } else {
      tasksFailed++;
    }
  }

  return {
    tasksConsidered: tasks.length,
    tasksPushed,
    tasksSkippedZero,
    tasksFailed,
    hoursPushed,
    warnings,
    pushedBatches,
  };
}

// Exported for tests.
export const _internals = { roundSecondsToHours, buildPatch, COMPLETED_WORK_FIELD };
