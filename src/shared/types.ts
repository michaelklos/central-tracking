// ─── Task ────────────────────────────────────────────────────────────────────

export const TASK_SOURCES = ['ad-hoc', 'email', 'meeting-prep', 'plugin'] as const;
export type TaskSource = typeof TASK_SOURCES[number];

export const TASK_STATUSES = ['todo', 'in-progress', 'done', 'blocked'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  source: TaskSource;
  /** Identifier linking back to an external system (e.g. ADO work item ID) */
  externalId: string | null;
  /** Which plugin owns this external link */
  pluginId: string | null;
  /** User-defined manual sort order */
  sortOrder: number;
  /** Total tracked time in seconds (computed from time entries) */
  totalTimeSeconds: number;
  /** Time tracked today in seconds (computed from time entries) */
  todayTimeSeconds: number;
  /** Sum of seconds in time entries that have not been reported externally. */
  unreportedTimeSeconds: number;
  /** Convenience: unreportedTimeSeconds > 0. */
  hasUnreportedTime: boolean;
  /** Category/label IDs assigned to this task */
  categoryIds: string[];
  /** Free-form notes for the task */
  notes: string;
  /** Soft-delete timestamp (null = active, non-null = in recycle bin) */
  deletedAt: string | null;
  /** Link to the external system record (e.g. ADO work item URL). */
  externalUrl: string | null;
  /** Last-known state in the external system (raw string, e.g. ADO "Active"). */
  externalState: string | null;
  /** Last-known total reported hours in the external system. */
  externalCompletedHours: number | null;
  /** Timestamp of the most recent successful pull from the external system. */
  externalRefreshedAt: string | null;
  /** True when ct's status changed and the change has not yet been pushed. Renderer reads only. */
  stateDirty: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  source?: TaskSource;
  externalId?: string | null;
  pluginId?: string | null;
  categoryIds?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  source?: TaskSource;
  sortOrder?: number;
  categoryIds?: string[];
  notes?: string;
}

export interface BatchUpdateInput {
  status?: TaskStatus;
  source?: TaskSource;
  categoryIds?: string[];
}

/**
 * Input for `tasks:upsertExternal`. Used by plugins (e.g. ADO) to mirror
 * external work items into ct. Matched by `(pluginId, externalId)`; `source`
 * is always set to `'plugin'` on insert.
 */
export interface UpsertExternalTaskInput {
  pluginId: string;
  externalId: string;
  title: string;
  notes?: string;
  description?: string;
  status?: TaskStatus;
  externalUrl?: string | null;
  externalState?: string | null;
  externalCompletedHours?: number | null;
  externalRefreshedAt?: string | null;
}

// ─── Time Entry ──────────────────────────────────────────────────────────────

export interface TimeEntry {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  note: string;
  /** Timestamp the time entry was marked as reported to an external system
   * (e.g. ADO worklog). Null = not yet reported. */
  reportedAt: string | null;
  createdAt: string;
}

export interface CreateTimeEntryInput {
  taskId: string;
  startTime?: string;
  endTime?: string | null;
  note?: string;
}

export interface UpdateTimeEntryInput {
  startTime?: string;
  endTime?: string | null;
  note?: string;
  /** undefined = no change; null = unset; string = set to this ISO timestamp. */
  reportedAt?: string | null;
}

// ─── Comment ─────────────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  /** If true, this comment will be synced to the external source system */
  syncable: boolean;
  /** Has this comment been synced to the external source? */
  synced: boolean;
  /** ID of the comment in the external system (null = ct-only). */
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentInput {
  taskId: string;
  body: string;
  syncable?: boolean;
}

export interface UpdateCommentInput {
  body?: string;
  syncable?: boolean;
  synced?: boolean;
  externalId?: string | null;
}

/**
 * Input for `comments:upsertExternal`. Used by plugins to mirror external
 * comments into ct. Matched by `externalId`. Mirrored comments are always
 * `synced=true, syncable=false`.
 */
export interface UpsertExternalCommentInput {
  taskId: string;
  externalId: string;
  body: string;
}

/**
 * Comment row enriched with its task's `source` and `external_id`, returned
 * by `comments:getPendingSync`. Plugins use the external id to address the
 * remote system without a second per-comment lookup.
 */
export interface PendingSyncComment extends Comment {
  taskExternalId: string | null;
  taskSource: TaskSource;
}

// ─── Category / Label ────────────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface CreateCategoryInput {
  name: string;
  color?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  color?: string;
}

// ─── Sort ───────────────────────────────────────────────────────────────────

export type TaskSortBy = 'manual' | 'recent' | 'created' | 'alphabetical' | 'most-time-today';

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface PaginationParams {
  offset?: number;
  limit?: number;
}

export interface TaskFilterParams {
  search?: string;
  searchIn?: 'title' | 'all';
  status?: string | string[];
  source?: string | string[];
  /** Filter by owning plugin (e.g. 'ado'). Null = local-only tasks. */
  pluginId?: string | string[] | null;
  categoryId?: string | string[];
  /** Include only tasks that have at least one un-reported time entry. */
  hasUnreportedTime?: boolean;
  /** Include only tasks that have no categories assigned. */
  uncategorized?: boolean;
  /** YYYY-MM-DD. Include only tasks with at least one time entry whose
   *  start_time falls on or after this date. Empty/undefined = unbounded. */
  dateStart?: string;
  /** YYYY-MM-DD. Include only tasks with at least one time entry whose
   *  start_time falls on or before this date (inclusive end-of-day).
   *  Empty/undefined = unbounded. */
  dateEnd?: string;
}

export type TaskQueryParams = PaginationParams & TaskFilterParams & { sortBy?: TaskSortBy };

// ─── Report Mode ────────────────────────────────────────────────────────────

export type ReportMode = 'chart' | 'summary' | 'categories';

// ─── Reporting ──────────────────────────────────────────────────────────────

export interface TimeEntryReport {
  date: string;
  taskId: string;
  taskTitle: string;
  totalSeconds: number;
}

export interface SummaryReportEntry {
  date: string;
  taskId: string;
  taskTitle: string;
  taskSource: TaskSource;
  taskStatus: TaskStatus;
  categoryIds: string[];
  totalSeconds: number;
}

export interface TimeEntryWithTask extends TimeEntry {
  taskTitle: string;
  taskSource: TaskSource;
}

// ─── Import ─────────────────────────────────────────────────────────────────

export interface ParsedImportItem {
  lineNumber: number;
  title: string;
  externalId: string | null;
  source: TaskSource;
  pluginId: string | null;
  date: string;           // "2026-03-04"
  startTime: string;      // "09:30"
  durationSeconds: number;
  startDateTime: string;  // ISO
  endDateTime: string;    // ISO
}

export interface ImportPreviewItem extends ParsedImportItem {
  existingTask: { id: string; title: string } | null;
  /** create = new task+entry, update = add entry to existing task, skip = do nothing */
  action: 'create' | 'update' | 'skip';
}

export interface ImportPreview {
  items: ImportPreviewItem[];
  errors: ImportError[];
  filePath: string;
}

export interface ImportError {
  lineNumber: number;
  line: string;
  reason: string;
}

export interface ImportResult {
  /** Number of new tasks created. */
  created: number;
  /** Number of time entries appended to existing tasks (matched by external_id or exact title). */
  updated: number;
  /** Number of items whose action was 'skip'. */
  skipped: number;
  errors: string[];
}

// ─── Plugins ────────────────────────────────────────────────────────────────

/**
 * Per-key declaration in a plugin's `configSchema`. Drives:
 *  - whether the value is encrypted at rest via Electron safeStorage,
 *  - whether the value can be sourced from `CT_PLUGIN_<ID>_<KEY>` env var,
 *  - required-key gating at `ct plugin run` time,
 *  - the `ct plugin schema <id>` listing.
 */
export interface PluginConfigKeySpec {
  required: boolean;
  /** Sensitive values are encrypted at rest and masked in CLI output. */
  secret: boolean;
  /** Human-readable hint shown by `ct plugin schema <id>`. */
  description?: string;
}

/**
 * Plugin manifest loaded from `plugin.json`. Supplied by the plugin author;
 * `ct plugin install` validates and persists a snapshot into the plugins table.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Command to run (e.g. "node sync.js" or "./bin/my-plugin"). Used by `ct plugin run`. */
  entrypoint?: string;
  /**
   * Pre-tokenized argv. When set, takes precedence over `entrypoint`. Used
   * by the bundled-plugin registrar so paths with spaces (e.g. macOS
   * `/Applications/Central Tracking.app/...`) survive without shell quoting.
   */
  entrypointArgv?: string[];
  /** Event names this plugin subscribes to (e.g. "task.created"). '*' matches all. */
  events?: string[];
  /** Loopback webhook URL that receives POSTed events. */
  webhook?: { url: string };
  /**
   * Declared config keys with required/secret/description metadata.
   * When omitted, the plugin's config behaves as today (settable but no
   * encryption hints, no required-key validation, no schema listing).
   */
  configSchema?: Record<string, PluginConfigKeySpec>;
  /**
   * Extra env vars merged into the child process when `ct plugin run` spawns
   * the entrypoint. The bundled-plugin registrar uses this to inject
   * `ELECTRON_RUN_AS_NODE=1` so the entrypoint runs under Electron-as-Node
   * without requiring a system `node` install.
   */
  env?: Record<string, string>;
  /**
   * Default capabilities surfaced by `plugins:getCapabilities`. Shape is
   * intentionally untyped (`Record<string, unknown>`) so plugins can evolve
   * their own flags without bumping a shared types contract — the renderer
   * casts to the shape it expects per consumer.
   *
   * Conventional keys (defined by callers, not enforced here):
   * - `tracksReported: boolean` — when false, the renderer hides
   *   unreported badges/batch actions for tasks owned by this plugin.
   *
   * Capabilities are defaults; a user-set plugin_config key overrides at
   * the plugin/runtime level. The override key follows the kebab-case
   * config-key convention (e.g. `tracks-reported`) while the capability
   * uses camelCase (`tracksReported`) — they refer to the same flag with
   * different naming conventions on each side of the bridge.
   * `usePluginCapabilities` in the renderer is responsible for mapping
   * one to the other.
   */
  capabilities?: Record<string, unknown>;
}

/**
 * Row returned by `plugins:getCapabilities`. The `capabilities` field is the
 * manifest-declared map verbatim; consumers cast it to the shape they expect.
 */
export interface PluginCapabilitiesEntry {
  id: string;
  enabled: boolean;
  capabilities: Record<string, unknown>;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  manifest: PluginManifest;
  installedAt: string;
  /** 'bundled' = ships in the app, blocked from uninstall. 'sideloaded' = installed via `ct plugin install`. */
  source: 'bundled' | 'sideloaded';
}

export interface PluginConfigEntry {
  pluginId: string;
  key: string;
  /**
   * Cleartext when the caller is authorised to reveal (HTTP route with
   * reveal:true). Masked string (`[encrypted]` or `[plaintext-secret]`) when
   * the boundary refused to reveal. Never raw ciphertext — that's an
   * implementation detail of `secretStorage`.
   */
  value: string;
  /** From the plugin manifest's `configSchema[key].secret` (false if undeclared). */
  secret: boolean;
  /** How the value is stored on disk for this row. */
  stored: 'encrypted' | 'plaintext';
}

/**
 * Merged view of a plugin's `configSchema` + actual DB state. Drives
 * `ct plugin schema <id>` and the required-key gating in `ct plugin run`.
 */
export interface PluginConfigSchemaEntry {
  key: string;
  required: boolean;
  secret: boolean;
  description?: string;
  /** `plaintext-secret` flags a declared-secret key whose row is still raw. */
  status: 'unset' | 'set' | 'encrypted' | 'plaintext-secret';
  /** Set for secret keys. `CT_PLUGIN_<ID_UPPER>_<KEY_UPPER>` (- → _). */
  envVarName: string | null;
}

/** Masked sentinel returned in place of a cleartext value when reveal=false. */
export const PLUGIN_SECRET_MASK_ENCRYPTED = '[encrypted]';
export const PLUGIN_SECRET_MASK_PLAINTEXT = '[plaintext-secret]';

/**
 * Envelope version. Bump on breaking change (field rename, field removed,
 * semantics changed). Additive changes — new optional fields, new event
 * names — do NOT bump the version: plugins should tolerate unknown fields.
 * Plugins that see a version they don't recognise should log + accept;
 * never hard-fail on a newer envelope.
 */
export type WebhookEnvelopeVersion = '1';
export const WEBHOOK_ENVELOPE_VERSION: WebhookEnvelopeVersion = '1';

export interface WebhookEvent {
  version: WebhookEnvelopeVersion;
  event: string;        // e.g. "task.created"
  route: string;        // e.g. "tasks/create"
  data: unknown;        // handler return value
  timestamp: string;    // ISO timestamp
}

// ─── API bridge type (exposed via preload) ───────────────────────────────────

export interface CentralTrackingAPI {
  tasks: {
    getAll(): Promise<Task[]>;
    getById(id: string): Promise<Task | null>;
    getActive(params?: TaskQueryParams): Promise<PaginatedResponse<Task>>;
    getActiveIds(params?: TaskQueryParams): Promise<string[]>;
    getDone(params?: TaskQueryParams): Promise<PaginatedResponse<Task>>;
    create(input: CreateTaskInput): Promise<Task>;
    update(id: string, input: UpdateTaskInput): Promise<Task>;
    delete(id: string): Promise<void>;
    reorder(orderedIds: string[]): Promise<void>;
    batchUpdate(ids: string[], input: BatchUpdateInput): Promise<{ updatedCount: number }>;
    batchSoftDelete(ids: string[]): Promise<{ deletedCount: number }>;
    getDeleted(params?: PaginationParams): Promise<PaginatedResponse<Task>>;
    restore(id: string): Promise<Task>;
    batchRestore(ids: string[]): Promise<{ restoredCount: number }>;
    purgeDeleted(id: string): Promise<void>;
    emptyRecycleBin(): Promise<void>;
    restoreAll(): Promise<{ restoredCount: number }>;
    deleteAll(): Promise<{ deletedCount: number }>;
    resetApp(): Promise<void>;
    upsertExternal(input: UpsertExternalTaskInput): Promise<Task>;
    setExternalState(id: string, externalState: string): Promise<{ ok: true }>;
    /**
     * Manually link an existing task to a remote ticket served by `pluginId`.
     * `mode: 'link'` just stores plugin_id/external_id (task stays editable).
     * `mode: 'mirror'` also flips `source` to the plugin's source key so the
     * task behaves as a pulled mirror (locked, FSM enforced, refreshable).
     */
    link(id: string, input: { pluginId: string; externalId: string; mode: 'link' | 'mirror' }): Promise<Task>;
    /** Reverse of link. For mirror-mode tasks, also resets source to 'ad-hoc'. */
    unlink(id: string): Promise<Task>;
  };
  timeEntries: {
    getByTask(taskId: string): Promise<TimeEntry[]>;
    getByTaskPaginated(taskId: string, params?: PaginationParams): Promise<PaginatedResponse<TimeEntry>>;
    create(input: CreateTimeEntryInput): Promise<TimeEntry>;
    update(id: string, input: UpdateTimeEntryInput): Promise<TimeEntry>;
    delete(id: string): Promise<void>;
    getActiveEntry(): Promise<TimeEntry | null>;
    stopActive(): Promise<TimeEntry | null>;
    getTodayTotal(): Promise<number>;
    getByDateRange(start: string, end: string): Promise<TimeEntry[]>;
    getReport(start: string, end: string): Promise<TimeEntryReport[]>;
    getSummaryReport(start: string, end: string): Promise<SummaryReportEntry[]>;
    getByDateRangeWithTasks(start: string, end: string): Promise<TimeEntryWithTask[]>;
    /**
     * Bulk-set reportedAt for all time entries on a task. Pass an ISO
     * timestamp to mark unreported entries as reported (preserves any prior
     * reportedAt on already-reported entries). Pass null to unset all entries
     * on the task. Returns the count of rows changed.
     */
    markTaskReported(taskId: string, reportedAt: string | null): Promise<{ changed: number }>;
    /**
     * Bulk-set reportedAt across many tasks, optionally restricted to a date
     * range (YYYY-MM-DD, inclusive end-of-day). `reportedAt: null` clears.
     */
    batchMarkReported(
      taskIds: string[],
      opts: { reportedAt: string | null; dateStart?: string; dateEnd?: string },
    ): Promise<{ changed: number }>;
  };
  comments: {
    getByTask(taskId: string): Promise<Comment[]>;
    create(input: CreateCommentInput): Promise<Comment>;
    update(id: string, input: UpdateCommentInput): Promise<Comment>;
    delete(id: string): Promise<void>;
    upsertExternal(input: UpsertExternalCommentInput): Promise<Comment>;
  };
  categories: {
    getAll(): Promise<Category[]>;
    create(input: CreateCategoryInput): Promise<Category>;
    update(id: string, input: UpdateCategoryInput): Promise<Category>;
    delete(id: string): Promise<void>;
    assignToTask(taskId: string, categoryIds: string[]): Promise<void>;
  };
  window: {
    setAlwaysOnTop(flag: boolean): Promise<void>;
    getAlwaysOnTop(): Promise<boolean>;
  };
  reports: {
    exportCsv(start: string, end: string): Promise<string | null>;
  };
  import: {
    selectAndParse(): Promise<ImportPreview | null>;
    execute(items: ImportPreviewItem[]): Promise<ImportResult>;
  };
  cli: {
    isInstalled(): Promise<boolean>;
    install(): Promise<{ ok: boolean; error?: string }>;
    uninstall(): Promise<{ ok: boolean; error?: string }>;
  };
  plugins: {
    /** List installed plugins (enabled and disabled). */
    list(): Promise<Plugin[]>;
    /**
     * One-shot listing of `{ id, enabled, capabilities }` for every installed
     * plugin. Renderer feature gates that previously fanned out N `getConfig`
     * calls (one per plugin) should read from here instead.
     */
    getCapabilities(): Promise<PluginCapabilitiesEntry[]>;
    /** Toggle a plugin's enabled flag. Returns the updated plugin row. */
    setEnabled(id: string, enabled: boolean): Promise<Plugin>;
    /**
     * Read a single plugin config value (masked sentinel for secret keys —
     * the renderer cannot reveal cleartext over this bridge by design).
     */
    getConfig(id: string, key: string): Promise<string | null>;
    /**
     * Write a single plugin config value. Pass `opts.secret` to force
     * encryption when the manifest does not declare it; `opts.allowPlaintext`
     * to proceed without encryption when the keyring is unavailable.
     */
    setConfig(
      id: string,
      key: string,
      value: string,
      opts?: { secret?: boolean; allowPlaintext?: boolean },
    ): Promise<{ stored: 'encrypted' | 'plaintext'; warning?: string }>;
    /** List all config entries for a plugin (secrets masked). */
    listConfig(id: string): Promise<PluginConfigEntry[]>;
    /** Delete a single plugin config key. */
    deleteConfig(id: string, key: string): Promise<void>;
    /** Manifest-declared schema merged with current DB state. */
    schema(id: string): Promise<PluginConfigSchemaEntry[]>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  log: {
    error(message: string): void;
    warn(message: string): void;
  };
  platform: string;
  onDataChanged(callback: () => void): () => void;
}
