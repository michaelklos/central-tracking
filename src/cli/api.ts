import type {
  Task,
  TimeEntry,
  Comment,
  Category,
  CreateTaskInput,
  UpdateTaskInput,
  BatchUpdateInput,
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  CreateCommentInput,
  UpdateCommentInput,
  CreateCategoryInput,
  UpdateCategoryInput,
  PaginatedResponse,
  PaginationParams,
  TaskQueryParams,
  TimeEntryReport,
  SummaryReportEntry,
  TimeEntryWithTask,
  ImportPreviewItem,
  ImportResult,
  ImportError,
  Plugin,
  PluginManifest,
  PluginConfigEntry,
} from '../shared/types';

export type RawRequest = <T = unknown>(endpoint: string, args?: unknown[]) => Promise<T>;

export interface ApiClient {
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
  };
  timeEntries: {
    getByTask(taskId: string): Promise<TimeEntry[]>;
    getByTaskPaginated(taskId: string, params?: PaginationParams): Promise<PaginatedResponse<TimeEntry>>;
    create(input: CreateTimeEntryInput): Promise<TimeEntry>;
    update(id: string, input: UpdateTimeEntryInput): Promise<TimeEntry>;
    delete(id: string): Promise<void>;
    getActive(): Promise<TimeEntry | null>;
    stopActive(): Promise<TimeEntry | null>;
    getTodayTotal(): Promise<number>;
    getByDateRange(start: string, end: string): Promise<TimeEntry[]>;
    getReport(start: string, end: string): Promise<TimeEntryReport[]>;
    getSummaryReport(start: string, end: string): Promise<SummaryReportEntry[]>;
    getByDateRangeWithTasks(start: string, end: string): Promise<TimeEntryWithTask[]>;
    markTaskReported(taskId: string, reportedAt: string | null): Promise<{ changed: number }>;
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
  reports: {
    generateCsv(start: string, end: string): Promise<string>;
  };
  import: {
    parseContent(content: string): Promise<{ items: ImportPreviewItem[]; errors: ImportError[] }>;
    execute(items: ImportPreviewItem[]): Promise<ImportResult>;
  };
  plugins: {
    list(): Promise<Plugin[]>;
    get(id: string): Promise<Plugin | null>;
    install(manifest: PluginManifest): Promise<Plugin>;
    uninstall(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<Plugin>;
    getConfig(id: string, key: string): Promise<string | null>;
    listConfig(id: string): Promise<PluginConfigEntry[]>;
    setConfig(id: string, key: string, value: string): Promise<void>;
    deleteConfig(id: string, key: string): Promise<void>;
  };
}

export function createApiClient(request: RawRequest): ApiClient {
  return {
    tasks: {
      getAll: () => request<Task[]>('tasks/getAll'),
      getById: (id) => request<Task | null>('tasks/getById', [id]),
      getActive: (params) => request<PaginatedResponse<Task>>('tasks/getActive', [params ?? {}]),
      getActiveIds: (params) => request<string[]>('tasks/getActiveIds', [params ?? {}]),
      getDone: (params) => request<PaginatedResponse<Task>>('tasks/getDone', [params ?? {}]),
      create: (input) => request<Task>('tasks/create', [input]),
      update: (id, input) => request<Task>('tasks/update', [id, input]),
      delete: (id) => request<void>('tasks/delete', [id]),
      reorder: (ids) => request<void>('tasks/reorder', [ids]),
      batchUpdate: (ids, input) => request<{ updatedCount: number }>('tasks/batchUpdate', [ids, input]),
      batchSoftDelete: (ids) => request<{ deletedCount: number }>('tasks/batchSoftDelete', [ids]),
      getDeleted: (params) => request<PaginatedResponse<Task>>('tasks/getDeleted', [params ?? {}]),
      restore: (id) => request<Task>('tasks/restore', [id]),
      batchRestore: (ids) => request<{ restoredCount: number }>('tasks/batchRestore', [ids]),
      purgeDeleted: (id) => request<void>('tasks/purgeDeleted', [id]),
      emptyRecycleBin: () => request<void>('tasks/emptyRecycleBin'),
      restoreAll: () => request<{ restoredCount: number }>('tasks/restoreAll'),
      deleteAll: () => request<{ deletedCount: number }>('tasks/deleteAll'),
    },
    timeEntries: {
      getByTask: (taskId) => request<TimeEntry[]>('timeEntries/getByTask', [taskId]),
      getByTaskPaginated: (taskId, params) =>
        request<PaginatedResponse<TimeEntry>>('timeEntries/getByTaskPaginated', [taskId, params ?? {}]),
      create: (input) => request<TimeEntry>('timeEntries/create', [input]),
      update: (id, input) => request<TimeEntry>('timeEntries/update', [id, input]),
      delete: (id) => request<void>('timeEntries/delete', [id]),
      getActive: () => request<TimeEntry | null>('timeEntries/getActive'),
      stopActive: () => request<TimeEntry | null>('timeEntries/stopActive'),
      getTodayTotal: () => request<number>('timeEntries/getTodayTotal'),
      getByDateRange: (start, end) => request<TimeEntry[]>('timeEntries/getByDateRange', [start, end]),
      getReport: (start, end) => request<TimeEntryReport[]>('timeEntries/getReport', [start, end]),
      getSummaryReport: (start, end) =>
        request<SummaryReportEntry[]>('timeEntries/getSummaryReport', [start, end]),
      getByDateRangeWithTasks: (start, end) =>
        request<TimeEntryWithTask[]>('timeEntries/getByDateRangeWithTasks', [start, end]),
      markTaskReported: (taskId, reportedAt) =>
        request<{ changed: number }>('timeEntries/markTaskReported', [taskId, reportedAt]),
    },
    comments: {
      getByTask: (taskId) => request<Comment[]>('comments/getByTask', [taskId]),
      create: (input) => request<Comment>('comments/create', [input]),
      update: (id, input) => request<Comment>('comments/update', [id, input]),
      delete: (id) => request<void>('comments/delete', [id]),
    },
    categories: {
      getAll: () => request<Category[]>('categories/getAll'),
      create: (input) => request<Category>('categories/create', [input]),
      update: (id, input) => request<Category>('categories/update', [id, input]),
      delete: (id) => request<void>('categories/delete', [id]),
      assignToTask: (taskId, categoryIds) =>
        request<void>('categories/assignToTask', [taskId, categoryIds]),
    },
    reports: {
      generateCsv: (start, end) => request<string>('reports/generateCsv', [start, end]),
    },
    import: {
      parseContent: (content) =>
        request<{ items: ImportPreviewItem[]; errors: ImportError[] }>('import/parseContent', [content]),
      execute: (items) => request<ImportResult>('import/execute', [items]),
    },
    plugins: {
      list: () => request<Plugin[]>('plugins/list'),
      get: (id) => request<Plugin | null>('plugins/get', [id]),
      install: (manifest) => request<Plugin>('plugins/install', [manifest]),
      uninstall: (id) => request<void>('plugins/uninstall', [id]),
      setEnabled: (id, enabled) => request<Plugin>('plugins/setEnabled', [id, enabled]),
      getConfig: (id, key) => request<string | null>('plugins/getConfig', [id, key]),
      listConfig: (id) => request<PluginConfigEntry[]>('plugins/listConfig', [id]),
      setConfig: (id, key, value) => request<void>('plugins/setConfig', [id, key, value]),
      deleteConfig: (id, key) => request<void>('plugins/deleteConfig', [id, key]),
    },
  };
}
