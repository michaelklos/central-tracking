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
