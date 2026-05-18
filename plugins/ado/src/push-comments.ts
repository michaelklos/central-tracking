/**
 * Push ct comments → ADO work item comments (additive, append-only).
 *
 * Per pending sync comment:
 *   1. Render `body` (markdown) → HTML via `marked` (ADO comments accept HTML).
 *   2. POST to ADO via `postWorkItemComment`.
 *   3. On 200: stamp ct comment with `synced=true` and the returned
 *      `external_id`. If this stamping fails, propagate — next run would
 *      otherwise re-post the same comment.
 *   4. On failure: leave `synced=false` and log; the next run retries.
 *
 * Skips comments whose task has no `external_id` (shouldn't happen for
 * source='ado' tasks, but defensive: a task that lost its mirror would
 * otherwise loop forever).
 */
import { marked } from 'marked';
import { AdoClient } from './ado-client';
import { CtClient } from './ct-client';
import { describeError } from './lib/ado-errors';
import type { CtPendingSyncComment } from './types';

export interface PushCommentsResult {
  considered: number;
  pushed: number;
  failed: number;
  warnings: string[];
}

function renderMarkdown(body: string): string {
  return marked.parse(body, { async: false }) as string;
}

async function pushOneComment(
  ado: AdoClient,
  ct: CtClient,
  comment: CtPendingSyncComment,
  warnings: string[],
): Promise<'pushed' | 'failed'> {
  if (!comment.taskExternalId) {
    warnings.push(
      `[ado] push-comments: comment ${comment.id} task has no external_id, skipping`,
    );
    return 'failed';
  }
  const workItemId = Number(comment.taskExternalId);
  if (!Number.isFinite(workItemId)) {
    warnings.push(
      `[ado] push-comments: comment ${comment.id} task external_id "${comment.taskExternalId}" not numeric, skipping`,
    );
    return 'failed';
  }

  let posted: { id: number };
  try {
    const html = renderMarkdown(comment.body);
    posted = await ado.postWorkItemComment(workItemId, html);
  } catch (err) {
    warnings.push(
      `[ado] push-comments: comment ${comment.id} POST failed: ${describeError(err)}`,
    );
    return 'failed';
  }

  // POST succeeded — if the bookkeeping update fails the next run would
  // double-post, so propagate the error to the caller. Same footgun as in
  // push-time's markTaskReported step.
  await ct.updateComment(comment.id, { synced: true, externalId: String(posted.id) });
  return 'pushed';
}

export async function pushComments(
  ado: AdoClient,
  ct: CtClient,
): Promise<PushCommentsResult> {
  const warnings: string[] = [];
  const comments = await ct.getPendingSyncComments('ado');

  let pushed = 0;
  let failed = 0;
  for (const c of comments) {
    const outcome = await pushOneComment(ado, ct, c, warnings);
    if (outcome === 'pushed') pushed++;
    else failed++;
  }

  return { considered: comments.length, pushed, failed, warnings };
}

export const _internals = { renderMarkdown };
