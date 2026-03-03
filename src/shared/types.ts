// ─── Task ────────────────────────────────────────────────────────────────────

export type TaskSource = 'ad-hoc' | 'email' | 'meeting-prep' | 'plugin';

export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'blocked';

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
  sortOrder?: number;
  categoryIds?: string[];
  notes?: string;
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

// ─── Reporting ──────────────────────────────────────────────────────────────

export interface TimeEntryReport {
  date: string;
  taskId: string;
  taskTitle: string;
  totalSeconds: number;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  configFields: PluginConfigField[];
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'url' | 'number' | 'boolean';
  required: boolean;
}

export interface PluginSyncResult {
  created: number;
  updated: number;
  errors: string[];
}

// ─── API bridge type (exposed via preload) ───────────────────────────────────

export interface CentralTrackingAPI {
  tasks: {
    getAll(): Promise<Task[]>;
    getById(id: string): Promise<Task | null>;
    getActive(params?: PaginationParams): Promise<PaginatedResponse<Task>>;
    getDone(params?: PaginationParams): Promise<PaginatedResponse<Task>>;
    create(input: CreateTaskInput): Promise<Task>;
    update(id: string, input: UpdateTaskInput): Promise<Task>;
    delete(id: string): Promise<void>;
    reorder(orderedIds: string[]): Promise<void>;
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
  plugins: {
    list(): Promise<PluginInfo[]>;
    sync(pluginId: string): Promise<PluginSyncResult>;
  };
  window: {
    setAlwaysOnTop(flag: boolean): Promise<void>;
    getAlwaysOnTop(): Promise<boolean>;
  };
  reports: {
    exportCsv(start: string, end: string): Promise<string | null>;
  };
}
