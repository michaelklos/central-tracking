/**
 * Loopback client to the ct HTTP server. Reads CT_SERVER_URL and CT_TOKEN
 * from env (set by `ct plugin run`). Stage 0 wires only the surface that
 * Stage 1+ will use; methods are added as needed.
 */
import axios, { AxiosInstance } from 'axios';
import type {
  CtTask,
  CtComment,
  CtPendingSyncComment,
  CtTimeEntry,
  UpsertExternalTaskInput,
  UpsertExternalCommentInput,
  PluginConfigEntry,
} from './types';

export interface GetTasksFilter {
  source?: string[];
  hasUnreportedTime?: boolean;
  stateDirty?: boolean;
}

export interface UpdateCommentPatch {
  body?: string;
  syncable?: boolean;
  synced?: boolean;
  externalId?: string | null;
}

export interface CtClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

export class CtClient {
  private readonly http: AxiosInstance;
  public readonly pluginId: string;

  constructor(opts: CtClientOptions = {}) {
    const baseURL = opts.baseUrl ?? process.env.CT_SERVER_URL;
    const token = opts.token ?? process.env.CT_TOKEN;
    if (!baseURL) throw new Error('CT_SERVER_URL not set (run via `ct plugin run ado`)');
    if (!token) throw new Error('CT_TOKEN not set (run via `ct plugin run ado`)');
    this.pluginId = process.env.CT_PLUGIN_ID ?? 'ado';
    this.http = axios.create({
      baseURL,
      timeout: opts.timeoutMs ?? 15000,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  }

  private async call<T>(route: string, args: unknown[] = []): Promise<T> {
    const res = await this.http.post(`/api/${route}`, { args });
    const body = res.data as { ok: boolean; data?: T; error?: { code: string; message: string } };
    if (!body.ok) {
      throw new Error(`ct ${route} failed: ${body.error?.code} ${body.error?.message}`);
    }
    return body.data as T;
  }

  // ─── Plugin config ───
  listPluginConfig(): Promise<PluginConfigEntry[]> {
    return this.call('plugins/listConfig', [this.pluginId]);
  }

  getPluginConfig(key: string): Promise<string | null> {
    return this.call('plugins/getConfig', [this.pluginId, key]);
  }

  // ─── Tasks ───
  getTaskById(id: string): Promise<CtTask | null> {
    return this.call('tasks/getById', [id]);
  }

  /**
   * Fetch all tasks and filter client-side. The HTTP `tasks/getAll` route
   * does not accept filter params; we keep that surface stable and filter
   * here to avoid expanding the backend handler for one consumer.
   */
  async getTasks(filter: GetTasksFilter = {}): Promise<CtTask[]> {
    const all = await this.call<CtTask[]>('tasks/getAll', []);
    return all.filter((t) => {
      if (filter.source && !filter.source.includes(t.source)) return false;
      if (filter.hasUnreportedTime === true && !t.hasUnreportedTime) return false;
      if (filter.stateDirty === true && !t.stateDirty) return false;
      return true;
    });
  }

  upsertExternalTask(input: UpsertExternalTaskInput): Promise<CtTask> {
    return this.call('tasks/upsertExternal', [input]);
  }

  setExternalTaskState(taskId: string, externalState: string): Promise<{ ok: true }> {
    return this.call('tasks/setExternalState', [taskId, externalState]);
  }

  // ─── Time entries ───
  /**
   * Fetch time entries for a task. The `unreportedOnly` filter is applied
   * client-side; the backend handler returns every entry regardless of
   * `reported_at`.
   */
  async getTimeEntriesByTask(
    taskId: string,
    opts: { unreportedOnly?: boolean } = {},
  ): Promise<CtTimeEntry[]> {
    const entries = await this.call<CtTimeEntry[]>('timeEntries/getByTask', [taskId]);
    if (opts.unreportedOnly) return entries.filter((e) => e.reportedAt === null);
    return entries;
  }

  markTaskReported(taskId: string, reportedAt: string | null): Promise<{ changed: number }> {
    return this.call('timeEntries/markTaskReported', [taskId, reportedAt]);
  }

  // ─── Comments ───
  upsertExternalComment(input: UpsertExternalCommentInput): Promise<CtComment> {
    return this.call('comments/upsertExternal', [input]);
  }

  /**
   * Pending outbound comments for a given source — `syncable=1 AND synced=0`
   * joined to the task's `source`. The backend handler does the join so the
   * plugin doesn't have to pull every task to figure out which comments to
   * push.
   */
  getPendingSyncComments(source: string): Promise<CtPendingSyncComment[]> {
    return this.call('comments/getPendingSync', [source]);
  }

  updateComment(id: string, patch: UpdateCommentPatch): Promise<CtComment> {
    return this.call('comments/update', [id, patch]);
  }
}
