/**
 * Stage 3 sync orchestrator.
 *
 *   push-state → push-time (→ optional auto-comment) → push-comments → pull
 *
 * State first so any subsequent time/comment posts apply against the new
 * state. Pull last so the display reflects the final ADO state, including
 * what this run just pushed.
 *
 * Each step is best-effort: a failure in one step logs and continues. The
 * only thing that propagates is a bookkeeping failure after a successful
 * ADO write (push-time's markTaskReported, push-state's
 * setExternalTaskState, push-comments' updateComment) — those would cause
 * a double-write on the next run if swallowed.
 */
import { AdoClient } from './ado-client';
import type { AdoConfig } from './config';
import { CtClient } from './ct-client';
import { describeError } from './lib/ado-errors';
import { pull, type PullResult } from './pull';
import { pushComments, type PushCommentsResult } from './push-comments';
import { pushState, type PushStateResult } from './push-state';
import { pushTime, type PushedTaskBatch, type PushTimeResult } from './push-time';
import type { CtTimeEntry } from './types';

export interface SyncResult {
  state: PushStateResult;
  time: PushTimeResult;
  autoComments: { posted: number; failed: number; warnings: string[] };
  comments: PushCommentsResult;
  pull: PullResult;
}

function formatHours(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function isoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function buildAutoCommentBody(batch: PushedTaskBatch, today = isoDate()): string {
  const notes = batch.entries
    .map((e: CtTimeEntry) => e.note?.trim())
    .filter((n): n is string => !!n);
  const header = `+${formatHours(batch.hoursPushed)} logged ${today}:`;
  if (notes.length === 0) return header;
  return [header, ...notes.map((n) => `- ${n}`)].join('\n');
}

/**
 * Post one ADO comment per pushed-time batch when
 * `auto-comment-on-time-push=true`. Failures are logged and do NOT propagate
 * — the time PATCH already succeeded, so a missing comment is cosmetic.
 */
async function postAutoComments(
  ado: AdoClient,
  pushed: PushedTaskBatch[],
): Promise<{ posted: number; failed: number; warnings: string[] }> {
  const warnings: string[] = [];
  let posted = 0;
  let failed = 0;
  for (const batch of pushed) {
    const externalId = batch.task.externalId;
    if (!externalId) continue;
    const wid = Number(externalId);
    if (!Number.isFinite(wid)) continue;
    try {
      await ado.postWorkItemComment(wid, buildAutoCommentBody(batch));
      posted++;
    } catch (err) {
      failed++;
      warnings.push(
        `[ado] auto-comment: #${externalId} POST failed: ${describeError(err)}`,
      );
    }
  }
  return { posted, failed, warnings };
}

export async function sync(
  ado: AdoClient,
  ct: CtClient,
  config: AdoConfig,
): Promise<SyncResult> {
  const state = await pushState(ado, ct, config);
  const time = await pushTime(ado, ct, config);
  const autoComments = config.autoCommentOnTimePush
    ? await postAutoComments(ado, time.pushedBatches)
    : { posted: 0, failed: 0, warnings: [] };
  const comments = await pushComments(ado, ct);
  const pullResult = await pull(ado, ct, config);
  return { state, time, autoComments, comments, pull: pullResult };
}

export const _internals = { buildAutoCommentBody, formatHours };
