// ─── Task ────────────────────────────────────────────────────────────────────

export const TASK_SOURCES = ['ad-hoc', 'email', 'meeting-prep', 'plugin', 'ado'] as const;
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
 * external work items into ct. Matched by `(source, externalId)`.
 */
export interface UpsertExternalTaskInput {
  source: TaskSource;
  externalId: string;
  pluginId?: string | null;
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
  categoryId?: string | string[];
  /** Include only tasks that have at least one un-reported time entry. */
  hasUnreportedTime?: boolean;
  /** Include only tasks that have no categories assigned. */
  uncategorized?: boolean;
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
 * Plugin manifest loaded from `plugin.json`. Supplied by the plugin author;
 * `ct plugin install` validates and persists a snapshot into the plugins table.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Command to run (e.g. "node sync.js" or "./bin/my-plugin"). Used by `ct plugin run`. */
  entrypoint?: string;
  /** Event names this plugin subscribes to (e.g. "task.created"). '*' matches all. */
  events?: string[];
  /** Loopback webhook URL that receives POSTed events. */
  webhook?: { url: string };
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  manifest: PluginManifest;
  installedAt: string;
}

export interface PluginConfigEntry {
  pluginId: string;
  key: string;
  value: string;
}

export interface WebhookEvent {
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
