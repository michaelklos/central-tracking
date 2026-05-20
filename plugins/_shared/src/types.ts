/**
 * Plugin-facing payload shapes for ct HTTP API calls. Kept minimal and
 * standalone so plugins don't have to depend on the host's full
 * `src/shared/types.ts`. Add fields here as new HTTP routes need them.
 *
 * MUST stay in sync with `src/shared/types.ts` in the host. The shapes here
 * are a strict subset — fields the plugin doesn't read are intentionally
 * omitted to keep the surface small.
 */

export type CtTaskStatus = 'todo' | 'in-progress' | 'done' | 'blocked';

export interface CtTask {
  id: string;
  title: string;
  status: CtTaskStatus;
  source: string;
  pluginId: string | null;
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
  pluginId: string;
  externalId: string;
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
  /** Cleartext when the caller passed reveal:true; masked sentinel otherwise. */
  value: string;
  secret: boolean;
  stored: 'encrypted' | 'plaintext';
}

export interface PluginConfigSchemaEntry {
  key: string;
  required: boolean;
  secret: boolean;
  description?: string;
  status: 'unset' | 'set' | 'encrypted' | 'plaintext-secret';
  envVarName: string | null;
}
