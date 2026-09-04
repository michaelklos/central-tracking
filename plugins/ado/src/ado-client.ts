/**
 * Thin wrapper around the Azure DevOps REST API.
 *
 * Auth: PAT via Basic auth header (`:PAT` base64).
 * Retry: 5xx responses are retried once with exponential backoff (1s, 2s).
 * 4xx responses surface immediately.
 */
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import type {
  AdoIteration,
  AdoWiqlResult,
  AdoWorkItem,
  AdoWorkItemBatchResponse,
  AdoWorkItemComment,
  AdoWorkItemCommentsResponse,
  JsonPatchOp,
} from './types';

export interface AdoClientOptions {
  organization: string;
  project: string;
  pat: string;
  timeoutMs?: number;
}

const API_VERSION = '7.1';
const API_VERSION_PREVIEW_COMMENTS = '7.1-preview.4';
/**
 * Safety stop for comment paging. ADO caps a page at 200 comments, so this is
 * 10k comments on one work item -- far past anything real, and only there so a
 * server that keeps handing back a continuation token cannot loop forever.
 */
const MAX_COMMENT_PAGES = 50;
const WIQL_MAX_IDS = 200;

function isRetriable(err: AxiosError): boolean {
  if (!err.response) return true; // network error
  return err.response.status >= 500 && err.response.status < 600;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class AdoClient {
  private readonly http: AxiosInstance;
  private readonly orgBase: string;
  private readonly projBase: string;

  constructor(private readonly opts: AdoClientOptions) {
    const token = Buffer.from(`:${opts.pat}`).toString('base64');
    this.orgBase = `https://dev.azure.com/${encodeURIComponent(opts.organization)}`;
    this.projBase = `${this.orgBase}/${encodeURIComponent(opts.project)}`;
    this.http = axios.create({
      timeout: opts.timeoutMs ?? 30000,
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
      },
      // Treat 4xx/5xx as errors so retry logic can branch.
      validateStatus: (s) => s >= 200 && s < 300,
    });
  }

  private async request<T>(fn: () => Promise<AxiosResponse<T>>): Promise<T> {
    const backoffs = [1000, 2000];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= backoffs.length; attempt++) {
      try {
        const res = await fn();
        return res.data;
      } catch (e) {
        lastErr = e;
        const err = e as AxiosError;
        if (attempt < backoffs.length && isRetriable(err)) {
          await sleep(backoffs[attempt]);
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  /** GET current iteration for a team. ADO returns an array; pick the first. */
  async getCurrentIteration(team: string): Promise<AdoIteration | null> {
    const url =
      `${this.orgBase}/${encodeURIComponent(this.opts.project)}/` +
      `${encodeURIComponent(team)}/_apis/work/teamsettings/iterations` +
      `?$timeframe=current&api-version=${API_VERSION}`;
    const data = await this.request<{ value: AdoIteration[] }>(() => this.http.get(url));
    return data.value[0] ?? null;
  }

  /** Run a WIQL query, return matching work-item ids. */
  async wiqlQuery(query: string): Promise<number[]> {
    const url = `${this.projBase}/_apis/wit/wiql?api-version=${API_VERSION}`;
    const data = await this.request<AdoWiqlResult>(() =>
      this.http.post(url, { query }, { headers: { 'Content-Type': 'application/json' } }),
    );
    return data.workItems.map((w) => w.id);
  }

  /** Fetch full work items for a list of ids (batched, max 200 per call). */
  async getWorkItems(ids: number[], fields: string[]): Promise<AdoWorkItem[]> {
    if (ids.length === 0) return [];
    const out: AdoWorkItem[] = [];
    for (let i = 0; i < ids.length; i += WIQL_MAX_IDS) {
      const chunk = ids.slice(i, i + WIQL_MAX_IDS);
      const url = `${this.orgBase}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`;
      const data = await this.request<AdoWorkItemBatchResponse>(() =>
        this.http.post(
          url,
          { ids: chunk, fields },
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
      out.push(...data.value);
    }
    return out;
  }

  /** Fetch a single work item by id. */
  async getWorkItem(id: number, fields: string[]): Promise<AdoWorkItem> {
    const items = await this.getWorkItems([id], fields);
    if (items.length === 0) throw new Error(`ADO work item #${id} not found`);
    return items[0];
  }

  /**
   * PATCH a work item with a json-patch document.
   *
   * Bypasses the 5xx retry helper: PATCH conflicts (409 from a `test` op on
   * `/rev`) are NOT retriable by the generic helper — the caller in
   * `push-time.ts` / `push-state.ts` handles 409 explicitly with one
   * refetch+retry. Other 4xx/5xx errors propagate as AxiosError so callers
   * can branch on `err.response?.status`.
   */
  async patchWorkItem(id: number, ops: JsonPatchOp[]): Promise<AdoWorkItem> {
    const url = `${this.projBase}/_apis/wit/workitems/${id}?api-version=${API_VERSION}`;
    const res = await this.http.patch<AdoWorkItem>(url, ops, {
      headers: { 'Content-Type': 'application/json-patch+json' },
    });
    return res.data;
  }

  /**
   * Fetch every comment on a work item (preview API).
   *
   * The endpoint pages: it returns at most `count` of `totalCount` comments
   * and a `continuationToken` when more remain. Reading only the first page
   * silently truncated the mirror on any busy work item. The loop is bounded
   * by the token going away, plus a page cap so a server that always returns
   * a token cannot spin forever.
   */
  async getWorkItemComments(id: number): Promise<AdoWorkItemComment[]> {
    const base =
      `${this.projBase}/_apis/wit/workItems/${id}/comments` +
      `?api-version=${API_VERSION_PREVIEW_COMMENTS}`;
    const all: AdoWorkItemComment[] = [];
    let token: string | undefined;
    for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
      const url = token ? `${base}&continuationToken=${encodeURIComponent(token)}` : base;
      const data = await this.request<AdoWorkItemCommentsResponse>(() => this.http.get(url));
      all.push(...data.comments);
      token = data.continuationToken;
      if (!token || data.comments.length === 0) return all;
    }
    return all;
  }

  /**
   * Post a new comment on a work item. ADO accepts HTML in the `text` field;
   * the plugin renders comment markdown → HTML before calling. Returns the
   * minimal `{ id }` that the caller stamps into ct's `external_id`.
   */
  async postWorkItemComment(id: number, html: string): Promise<{ id: number }> {
    const url =
      `${this.projBase}/_apis/wit/workItems/${id}/comments` +
      `?api-version=${API_VERSION_PREVIEW_COMMENTS}`;
    const data = await this.request<{ id: number }>(() =>
      this.http.post(url, { text: html }, { headers: { 'Content-Type': 'application/json' } }),
    );
    return { id: data.id };
  }
}
