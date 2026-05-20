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
  PluginCapabilitiesEntry,
  PluginConfigEntry,
  PluginConfigSchemaEntry,
  UpsertExternalTaskInput,
  UpsertExternalCommentInput,
  PendingSyncComment,
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
    restoreAll(): Promise<{ restoredCount: number }>;
    deleteAll(): Promise<{ deletedCount: number }>;
    upsertExternal(input: UpsertExternalTaskInput): Promise<Task>;
    setExternalState(id: string, externalState: string): Promise<{ ok: true }>;
    link(id: string, input: { pluginId: string; externalId: string; mode: 'link' | 'mirror' }): Promise<Task>;
    unlink(id: string): Promise<Task>;
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
    getPendingSync(source: string): Promise<PendingSyncComment[]>;
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
    getCapabilities(): Promise<PluginCapabilitiesEntry[]>;
    get(id: string): Promise<Plugin | null>;
    install(manifest: PluginManifest): Promise<Plugin>;
    uninstall(
      id: string,
      opts?: { convertTasksToAdHoc?: boolean },
    ): Promise<
      | { uninstalled: true; convertedTasks: number }
      | { requiresConfirmation: true; taskCount: number }
    >;
    setEnabled(id: string, enabled: boolean): Promise<Plugin>;
    /** `opts.reveal=true` returns cleartext for secret keys; default masks. */
    getConfig(id: string, key: string, opts?: { reveal?: boolean }): Promise<string | null>;
    /** `opts.reveal=true` returns cleartext for secret entries; default masks. */
    listConfig(id: string, opts?: { reveal?: boolean }): Promise<PluginConfigEntry[]>;
    setConfig(
      id: string,
      key: string,
      value: string,
      opts?: { secret?: boolean; allowPlaintext?: boolean },
    ): Promise<{ stored: 'encrypted' | 'plaintext'; warning?: string }>;
    deleteConfig(id: string, key: string): Promise<void>;
    schema(id: string): Promise<PluginConfigSchemaEntry[]>;
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
      upsertExternal: (input) => request<Task>('tasks/upsertExternal', [input]),
      setExternalState: (id, externalState) =>
        request<{ ok: true }>('tasks/setExternalState', [id, externalState]),
      link: (id, input) => request<Task>('tasks/link', [id, input]),
      unlink: (id) => request<Task>('tasks/unlink', [id]),
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
      batchMarkReported: (taskIds, opts) =>
        request<{ changed: number }>('timeEntries/batchMarkReported', [taskIds, opts]),
    },
    comments: {
      getByTask: (taskId) => request<Comment[]>('comments/getByTask', [taskId]),
      create: (input) => request<Comment>('comments/create', [input]),
      update: (id, input) => request<Comment>('comments/update', [id, input]),
      delete: (id) => request<void>('comments/delete', [id]),
      upsertExternal: (input) => request<Comment>('comments/upsertExternal', [input]),
      getPendingSync: (source) => request<PendingSyncComment[]>('comments/getPendingSync', [source]),
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
      getCapabilities: () => request<PluginCapabilitiesEntry[]>('plugins/getCapabilities'),
      get: (id) => request<Plugin | null>('plugins/get', [id]),
      install: (manifest) => request<Plugin>('plugins/install', [manifest]),
      uninstall: (id, opts) =>
        request('plugins/uninstall', [id, opts ?? {}]),
      setEnabled: (id, enabled) => request<Plugin>('plugins/setEnabled', [id, enabled]),
      getConfig: (id, key, opts) => request<string | null>('plugins/getConfig', [id, key, opts ?? {}]),
      listConfig: (id, opts) => request<PluginConfigEntry[]>('plugins/listConfig', [id, opts ?? {}]),
      setConfig: (id, key, value, opts) =>
        request<{ stored: 'encrypted' | 'plaintext'; warning?: string }>('plugins/setConfig', [id, key, value, opts ?? {}]),
      deleteConfig: (id, key) => request<void>('plugins/deleteConfig', [id, key]),
      schema: (id) => request<PluginConfigSchemaEntry[]>('plugins/schema', [id]),
    },
  };
}
