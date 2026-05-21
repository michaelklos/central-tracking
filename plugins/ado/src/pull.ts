/**
 * Pull current-sprint ADO work items into ct.
 *
 * Order per run:
 *  1. resolve current iteration (path)
 *  2. WIQL → list of work-item ids in that iteration
 *  3. workitemsbatch → full fields
 *  4. for each: upsertExternalTask + mirror comments
 *
 * Idempotent: re-running with no ADO-side changes is a no-op (uppsertExternalTask
 * overwrites the same values; the renderer dedupes via debounced ct:data-changed).
 */
import TurndownService from 'turndown';
import { AdoClient } from './ado-client';
import type { AdoConfig } from './config';
import { CtClient } from './ct-client';
import { inverseStateMap } from './state-map';
import type {
  AdoWorkItem,
  CtTask,
  CtTaskStatus,
  UpsertExternalCommentInput,
  UpsertExternalTaskInput,
} from './types';

const WORK_ITEM_FIELDS = [
  'System.Id',
  'System.Title',
  'System.Description',
  'System.State',
  'System.WorkItemType',
  'System.ChangedDate',
  'System.IterationPath',
  'Microsoft.VSTS.Scheduling.CompletedWork',
];

export interface PullResult {
  tasksUpserted: number;
  commentsMirrored: number;
  unmappedStates: { id: number; state: string }[];
  warnings: string[];
}

function buildWiql(iterationPath: string, types: string[], pullClosed: boolean): string {
  const typeList = types.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
  const pathEsc = iterationPath.replace(/'/g, "''");
  const parts = [
    'SELECT [System.Id]',
    'FROM WorkItems',
    `WHERE [System.IterationPath] = '${pathEsc}'`,
    `AND [System.WorkItemType] IN (${typeList})`,
  ];
  if (!pullClosed) parts.push("AND [System.State] <> 'Closed'");
  parts.push('ORDER BY [System.Id]');
  return parts.join(' ');
}

function htmlToMd(turndown: TurndownService, html: string | undefined): string {
  if (!html) return '';
  return turndown.turndown(html).trim();
}

function workItemUrl(org: string, project: string, id: number): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
}

function buildTaskInput(
  config: AdoConfig,
  turndown: TurndownService,
  wi: AdoWorkItem,
  unmappedStates: { id: number; state: string }[],
): UpsertExternalTaskInput {
  const id = String(wi.id);
  const title = String(wi.fields['System.Title'] ?? '(untitled)');
  const description = wi.fields['System.Description'] as string | undefined;
  const state = String(wi.fields['System.State'] ?? '');
  const completed = (wi.fields['Microsoft.VSTS.Scheduling.CompletedWork'] as number | undefined) ?? 0;

  let status: CtTaskStatus = 'todo';
  if (state) {
    const mapped = inverseStateMap(config, state);
    if (mapped) {
      status = mapped;
    } else {
      unmappedStates.push({ id: wi.id, state });
    }
  }

  return {
    pluginId: 'ado',
    externalId: id,
    title: `#${id} - ${title}`,
    notes: htmlToMd(turndown, description),
    status,
    externalUrl: workItemUrl(config.organization, config.project, wi.id),
    externalState: state || null,
    externalCompletedHours: completed,
    externalRefreshedAt: new Date().toISOString(),
  };
}

async function mirrorComments(
  ado: AdoClient,
  ct: CtClient,
  workItemId: number,
  task: CtTask,
): Promise<number> {
  const comments = await ado.getWorkItemComments(workItemId);
  let count = 0;
  for (const c of comments) {
    const input: UpsertExternalCommentInput = {
      taskId: task.id,
      externalId: String(c.id),
      body: c.text,
    };
    await ct.upsertExternalComment(input);
    count++;
  }
  return count;
}

export async function pull(
  ado: AdoClient,
  ct: CtClient,
  config: AdoConfig,
): Promise<PullResult> {
  const warnings: string[] = [];
  if (!config.team) {
    throw new Error(
      'ado team is not configured. Set: ct plugin config set ado team <team-name>',
    );
  }

  const iteration = await ado.getCurrentIteration(config.team);
  if (!iteration) {
    warnings.push(`[ado] no current iteration for team "${config.team}"`);
    return { tasksUpserted: 0, commentsMirrored: 0, unmappedStates: [], warnings };
  }

  const wiql = buildWiql(iteration.path, config.workItemTypes, config.pullClosed);
  const ids = await ado.wiqlQuery(wiql);
  if (ids.length === 0) {
    return { tasksUpserted: 0, commentsMirrored: 0, unmappedStates: [], warnings };
  }

  const workItems = await ado.getWorkItems(ids, WORK_ITEM_FIELDS);
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const unmappedStates: { id: number; state: string }[] = [];
  let commentsMirrored = 0;

  for (const wi of workItems) {
    const input = buildTaskInput(config, turndown, wi, unmappedStates);
    const task = await ct.upsertExternalTask(input);
    commentsMirrored += await mirrorComments(ado, ct, wi.id, task);
  }

  for (const u of unmappedStates) {
    warnings.push(`[ado] unmapped state "${u.state}" on #${u.id}, defaulting to todo`);
  }

  return {
    tasksUpserted: workItems.length,
    commentsMirrored,
    unmappedStates,
    warnings,
  };
}

export async function refresh(
  ado: AdoClient,
  ct: CtClient,
  config: AdoConfig,
  ctTaskId: string,
): Promise<{ task: CtTask; commentsMirrored: number; warnings: string[] }> {
  const warnings: string[] = [];
  const existing = await ct.getTaskById(ctTaskId);
  if (!existing) throw new Error(`ct task ${ctTaskId} not found`);
  // refresh overwrites title/notes/status from ADO. That's only safe on
  // full mirrors (source='plugin') — link-only tasks are user-owned and
  // would lose local edits. Reject link-only with a clear message so the
  // caller knows to use `ct task update` or upgrade the link to a mirror.
  if (existing.pluginId !== 'ado' || existing.source !== 'plugin' || !existing.externalId) {
    throw new Error(
      `ct task ${ctTaskId} is not an ado full-mirror task ` +
        `(source=${existing.source}, pluginId=${existing.pluginId ?? 'null'}); ` +
        `refresh requires source='plugin' and pluginId='ado'`,
    );
  }
  const workItemId = Number(existing.externalId);
  if (!Number.isFinite(workItemId)) {
    throw new Error(`task ${ctTaskId} has non-numeric external_id "${existing.externalId}"`);
  }

  const wi = await ado.getWorkItem(workItemId, WORK_ITEM_FIELDS);
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const unmapped: { id: number; state: string }[] = [];
  const input = buildTaskInput(config, turndown, wi, unmapped);
  const task = await ct.upsertExternalTask(input);
  for (const u of unmapped) {
    warnings.push(`[ado] unmapped state "${u.state}" on #${u.id}, defaulting to todo`);
  }
  const commentsMirrored = await mirrorComments(ado, ct, workItemId, task);
  return { task, commentsMirrored, warnings };
}

// Exported for tests.
export const _internals = { buildWiql, buildTaskInput, WORK_ITEM_FIELDS };
