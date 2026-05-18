/**
 * Loopback client to the ct HTTP server. Reads CT_SERVER_URL and CT_TOKEN
 * from env (set by `ct plugin run`). Stage 0 wires only the surface that
 * Stage 1+ will use; methods are added as needed.
 */
import axios, { AxiosInstance } from 'axios';
import type {
  CtTask,
  CtComment,
  UpsertExternalTaskInput,
  UpsertExternalCommentInput,
  PluginConfigEntry,
} from './types';

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
  upsertExternalTask(input: UpsertExternalTaskInput): Promise<CtTask> {
    return this.call('tasks/upsertExternal', [input]);
  }

  setExternalTaskState(taskId: string, externalState: string): Promise<{ ok: true }> {
    return this.call('tasks/setExternalState', [taskId, externalState]);
  }

  // ─── Comments ───
  upsertExternalComment(input: UpsertExternalCommentInput): Promise<CtComment> {
    return this.call('comments/upsertExternal', [input]);
  }
}
