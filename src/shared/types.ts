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
  /** Category/label IDs assigned to this task */
  categoryIds: string[];
  /** Free-form notes for the task */
  notes: string;
  /** Soft-delete timestamp (null = active, non-null = in recycle bin) */
  deletedAt: string | null;
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

// ─── Time Entry ──────────────────────────────────────────────────────────────

export interface TimeEntry {
  id: string;
  taskId: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  note: string;
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
  status?: string;
  source?: string;
  categoryId?: string;
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
  created: number;
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
  };
  comments: {
    getByTask(taskId: string): Promise<Comment[]>;
    create(input: CreateCommentInput): Promise<Comment>;
    update(id: string, input: UpdateCommentInput): Promise<Comment>;
    delete(id: string): Promise<void>;
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
