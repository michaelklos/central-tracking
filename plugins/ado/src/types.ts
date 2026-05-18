/**
 * Plugin-local shapes for ct HTTP API payloads. Kept minimal and decoupled
 * from `src/shared/types.ts` so the plugin compiles standalone. Add fields
 * here as new Stages require them.
 */

export type CtTaskStatus = 'todo' | 'in-progress' | 'done' | 'blocked';

export interface CtTask {
  id: string;
  title: string;
  status: CtTaskStatus;
  source: string;
  externalId: string | null;
  externalUrl: string | null;
  externalState: string | null;
  externalCompletedHours: number | null;
  externalRefreshedAt: string | null;
  stateDirty: boolean;
  notes: string;
  unreportedTimeSeconds: number;
  hasUnreportedTime: boolean;
}

export interface CtComment {
  id: string;
  taskId: string;
  body: string;
  syncable: boolean;
  synced: boolean;
  externalId: string | null;
}

/**
 * Comment returned by `comments/getPendingSync`. The handler joins to `tasks`
 * so the plugin can address ADO without a second lookup per comment.
 */
export interface CtPendingSyncComment extends CtComment {
  taskExternalId: string | null;
  taskSource: string;
}

export interface CtTimeEntry {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  note: string;
  reportedAt: string | null;
  createdAt: string;
}

export interface UpsertExternalTaskInput {
  source: string;
  externalId: string;
  pluginId?: string | null;
  title: string;
  notes?: string;
  description?: string;
  status?: CtTaskStatus;
  externalUrl?: string | null;
  externalState?: string | null;
  externalCompletedHours?: number | null;
  externalRefreshedAt?: string | null;
}

export interface UpsertExternalCommentInput {
  taskId: string;
  externalId: string;
  body: string;
}

export interface PluginConfigEntry {
  pluginId: string;
  key: string;
  value: string;
}

// ─── ADO API response shapes ──────────────────────────────────────────────

export interface AdoIteration {
  id: string;
  name: string;
  path: string;
  attributes: {
    startDate: string | null;
    finishDate: string | null;
    timeFrame: 'past' | 'current' | 'future';
  };
}

export interface AdoWiqlResult {
  workItems: { id: number; url: string }[];
}

export interface AdoWorkItemFields {
  'System.Id'?: number;
  'System.Title'?: string;
  'System.Description'?: string;
  'System.State'?: string;
  'System.WorkItemType'?: string;
  'System.ChangedDate'?: string;
  'System.IterationPath'?: string;
  'Microsoft.VSTS.Scheduling.CompletedWork'?: number;
  [key: string]: unknown;
}

export interface AdoWorkItem {
  id: number;
  rev: number;
  fields: AdoWorkItemFields;
  url: string;
}

export interface AdoWorkItemBatchResponse {
  count: number;
  value: AdoWorkItem[];
}

export interface AdoWorkItemComment {
  id: number;
  workItemId: number;
  text: string;
  createdBy: { displayName: string; uniqueName: string };
  createdDate: string;
  modifiedDate?: string;
}

export interface AdoWorkItemCommentsResponse {
  totalCount: number;
  count: number;
  comments: AdoWorkItemComment[];
}

export interface JsonPatchOp {
  op: 'add' | 'replace' | 'test' | 'remove';
  path: string;
  value?: unknown;
}
