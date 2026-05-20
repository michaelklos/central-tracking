/**
 * ADO-specific types. Plugin payload shapes for ct (CtTask, CtComment, …)
 * live in `@central-tracking/plugin-client/types` and are re-exported below
 * for convenience.
 */

export type {
  CtTask,
  CtTaskStatus,
  CtComment,
  CtPendingSyncComment,
  CtTimeEntry,
  UpsertExternalTaskInput,
  UpsertExternalCommentInput,
  PluginConfigEntry,
  PluginConfigSchemaEntry,
} from '@central-tracking/plugin-client';

/**
 * Shape of one entry in the ADO `state-map` plugin config. Lives with the
 * plugin (not in the host's shared types) so adding a second plugin's state
 * map doesn't pull ADO-specific types into the host's surface.
 *
 * MUST stay in sync with the `stateMap` field on `AdoConfig`.
 */
export interface AdoStateMapEntry {
  ado: string;
  altIn: string[];
}
export type AdoStateMap = Record<string, AdoStateMapEntry>;

export const ADO_DEFAULT_STATE_MAP: AdoStateMap = {
  todo: { ado: 'New', altIn: ['New', 'To Do', 'Proposed'] },
  'in-progress': { ado: 'Active', altIn: ['Active', 'Committed', 'In Progress'] },
  done: { ado: 'Closed', altIn: ['Closed', 'Resolved', 'Done', 'Completed'] },
};

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
