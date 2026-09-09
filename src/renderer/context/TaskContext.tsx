import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { Task, Category, CreateTaskInput, UpdateTaskInput, BatchUpdateInput, CreateCategoryInput, UpdateCategoryInput, TaskSortBy, TaskStatus } from '../../shared/types';
// Page size is a setting, read per fetch so a change takes effect on the next
// refresh rather than needing a reload.
import { getPageSize } from '../utils/settings';

/**
 * The non-done statuses that get their own paginated section in the task
 * list. Each one pages independently, so the page-size setting is a
 * per-section limit rather than a budget shared across the whole list.
 * "done" is missing on purpose: it already has its own lazy pagination.
 */
export const SECTION_STATUSES: TaskStatus[] = ['todo', 'in-progress', 'blocked'];

/** One status section's loaded rows plus its server-side total. */
export interface TaskSection {
  items: Task[];
  /** Total matching the current filter, not just what is loaded. */
  total: number;
  hasMore: boolean;
}

const EMPTY_SECTION: TaskSection = { items: [], total: 0, hasMore: false };

interface TaskContextValue {
  // Legacy — combined view of all loaded tasks (for TaskDetail lookup)
  tasks: Task[];

  // Paginated active tasks
  activeTasks: Task[];
  activeTasksTotal: number;
  activeTasksHasMore: boolean;

  /** Per-status pages, keyed by status. Used by the status-grouped list. */
  statusSections: Record<string, TaskSection>;
  loadMoreStatusTasks(status: string): Promise<void>;

  // Paginated done tasks
  doneTasks: Task[];
  doneTasksTotal: number;
  doneTasksHasMore: boolean;
  doneTasksLoaded: boolean;

  // Paginated deleted tasks (recycle bin)
  deletedTasks: Task[];
  deletedTasksTotal: number;
  deletedTasksHasMore: boolean;
  deletedTasksLoaded: boolean;

  // Batch mode
  batchMode: boolean;
  selectedTaskIds: Set<string>;
  enterBatchMode(): void;
  exitBatchMode(): void;
  toggleTaskSelection(id: string): void;
  selectAllTasks(ids: string[]): void;
  deselectAllTasks(): void;
  batchUpdateTasks(input: BatchUpdateInput): Promise<void>;
  batchDeleteTasks(): Promise<void>;
  /**
   * Mark every time entry of the currently-selected tasks as reported (pass
   * an ISO timestamp) or unreported (pass null). Optional date range narrows
   * to entries whose start_time falls within [dateStart, dateEnd] inclusive.
   * Resolves with the number of rows updated.
   */
  batchMarkSelectedReported(
    reportedAt: string | null,
    dateRange?: { dateStart?: string; dateEnd?: string },
  ): Promise<{ changed: number }>;

  // Recycle bin operations
  loadDeletedTasks(): Promise<void>;
  loadMoreDeletedTasks(): Promise<void>;
  restoreTask(id: string): Promise<void>;
  batchRestoreTasks(ids: string[]): Promise<void>;
  purgeTask(id: string): Promise<void>;
  emptyRecycleBin(): Promise<void>;
  restoreAllDeleted(): Promise<void>;
  resetApp(): Promise<void>;

  categories: Category[];
  selectedTaskId: string | null;
  filter: TaskFilter;

  selectTask(id: string | null): void;
  setFilter: Dispatch<SetStateAction<TaskFilter>>;

  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  reorderTasks(orderedIds: string[]): Promise<void>;
  refreshTasks(): Promise<void>;

  // Paginated loading
  refreshActiveTasks(): Promise<void>;
  loadMoreActiveTasks(): Promise<void>;
  loadDoneTasks(): Promise<void>;
  loadMoreDoneTasks(): Promise<void>;

  createCategory(input: CreateCategoryInput): Promise<Category>;
  updateCategory(id: string, updates: UpdateCategoryInput): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
  refreshCategories(): Promise<void>;

  selectAllActiveTasks(): Promise<void>;

  sortBy: TaskSortBy;
  setSortBy(sortBy: TaskSortBy): void;

  pendingTimeEntry: { startTime: string; endTime: string } | null;
  setPendingTimeEntry(entry: { startTime: string; endTime: string } | null): void;
}

export interface TaskFilter {
  statuses?: string[];
  sources?: string[];
  categoryIds?: string[];
  search?: string;
  searchIn?: 'title' | 'all';
  /** When true, restrict listings to tasks that have un-reported time. */
  hasUnreportedTime?: boolean;
  /** When true, restrict listings to tasks with no categories assigned. */
  uncategorized?: boolean;
  /** YYYY-MM-DD lower bound: only tasks with a time entry on or after this date. */
  dateStart?: string;
  /** YYYY-MM-DD upper bound (inclusive end-of-day). */
  dateEnd?: string;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function useTaskContext(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used within a TaskProvider');
  return ctx;
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [activeTasksTotal, setActiveTasksTotal] = useState(0);
  const [activeTasksHasMore, setActiveTasksHasMore] = useState(false);

  const [statusSections, setStatusSections] = useState<Record<string, TaskSection>>(
    () => Object.fromEntries(SECTION_STATUSES.map((s) => [s, EMPTY_SECTION])),
  );

  const [doneTasks, setDoneTasks] = useState<Task[]>([]);
  const [doneTasksTotal, setDoneTasksTotal] = useState(0);
  const [doneTasksHasMore, setDoneTasksHasMore] = useState(false);
  const [doneTasksLoaded, setDoneTasksLoaded] = useState(false);

  const [deletedTasks, setDeletedTasks] = useState<Task[]>([]);
  const [deletedTasksTotal, setDeletedTasksTotal] = useState(0);
  const [deletedTasksHasMore, setDeletedTasksHasMore] = useState(false);
  const [deletedTasksLoaded, setDeletedTasksLoaded] = useState(false);

  const [batchMode, setBatchMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>(() => {
    // Seed searchIn from the persisted search mode so the Sidebar doesn't
    // trigger an extra refresh on mount just to push the default in.
    try {
      const stored = localStorage.getItem('central-tracking:search-mode');
      if (stored === 'title' || stored === 'all') {
        return { searchIn: stored };
      }
    } catch { /* ignore */ }
    return { searchIn: 'title' };
  });
  const [sortBy, setSortByState] = useState<TaskSortBy>(() => {
    try {
      const stored = localStorage.getItem('ct-sort-by');
      if (stored && ['manual', 'recent', 'created', 'alphabetical', 'most-time-today'].includes(stored)) {
        return stored as TaskSortBy;
      }
    } catch { /* ignore */ }
    return 'manual';
  });
  const [pendingTimeEntry, setPendingTimeEntry] = useState<{ startTime: string; endTime: string } | null>(null);

  // How many rows each paginated list currently holds. Kept in refs rather
  // than read off state: refreshes fire from the debounced `ct:data-changed`
  // handler and from post-mutation callbacks, where the closure's
  // `activeTasks.length` is stale (CLAUDE.md footguns 2 and 3).
  const activeLoadedRef = useRef(0);
  const sectionLoadedRef = useRef<Record<string, number>>(
    Object.fromEntries(SECTION_STATUSES.map((s) => [s, 0])),
  );
  const doneLoadedRef = useRef(0);
  const deletedLoadedRef = useRef(0);

  // The task the last createTask() returned, held only for as long as it is
  // absent from the loaded pages. New tasks sort to the tail of the list, so
  // past the first page selecting one would otherwise point `selectedTaskId`
  // at an id `tasks` cannot resolve and TaskDetail would render nothing.
  const [justCreatedTask, setJustCreatedTask] = useState<Task | null>(null);

  const setSortBy = useCallback((s: TaskSortBy) => {
    setSortByState(s);
    try { localStorage.setItem('ct-sort-by', s); } catch { /* ignore */ }
  }, []);

  // Combined view of all loaded tasks (for TaskDetail lookup by ID)
  const tasks = useMemo(() => {
    const loaded = [...activeTasks, ...doneTasks];
    if (justCreatedTask && !loaded.some((t) => t.id === justCreatedTask.id)) {
      loaded.push(justCreatedTask);
    }
    return loaded;
  }, [activeTasks, doneTasks, justCreatedTask]);

  // Drop the just-created slot once a real page contains the task.
  const clearJustCreatedIfPresent = useCallback((items: Task[]) => {
    setJustCreatedTask((prev) => (prev && items.some((t) => t.id === prev.id) ? null : prev));
  }, []);

  // Map renderer-side filter (plural keys) onto TaskQueryParams (singular keys).
  // Centralized so date-range and any future filter only need one place to wire.
  const filterToParams = useCallback(() => ({
    search: filter.search,
    searchIn: filter.searchIn,
    status: filter.statuses,
    source: filter.sources,
    categoryId: filter.categoryIds,
    hasUnreportedTime: filter.hasUnreportedTime,
    uncategorized: filter.uncategorized,
    dateStart: filter.dateStart,
    dateEnd: filter.dateEnd,
  }), [filter]);

  // A refresh restores every page the user has loaded, not just the first
  // one. Refetching only the first page would throw away everything
  // "load more" paged in on every mutation and every `ct:data-changed`.
  const refreshActiveList = useCallback(async () => {
    const res = await window.api.tasks.getActive({
      offset: 0, limit: Math.max(getPageSize(), activeLoadedRef.current), sortBy,
      ...filterToParams(),
    });
    activeLoadedRef.current = res.items.length;
    setActiveTasks(res.items);
    setActiveTasksTotal(res.total);
    setActiveTasksHasMore(res.hasMore);
    clearJustCreatedIfPresent(res.items);
  }, [sortBy, filterToParams, clearJustCreatedIfPresent]);

  // Each section is its own query, so its `total` is that status's total and
  // its page is that status's page. The status filter is applied last: a
  // sidebar filter narrows which sections exist, it never widens one.
  const refreshStatusSections = useCallback(async () => {
    const params = filterToParams();
    const selected = filter.statuses;
    const results = await Promise.all(SECTION_STATUSES.map(async (status) => {
      if (selected && selected.length > 0 && !selected.includes(status)) {
        sectionLoadedRef.current[status] = 0;
        return [status, EMPTY_SECTION] as const;
      }
      const res = await window.api.tasks.getActive({
        ...params,
        status: [status],
        offset: 0,
        limit: Math.max(getPageSize(), sectionLoadedRef.current[status] ?? 0),
        sortBy,
      });
      sectionLoadedRef.current[status] = res.items.length;
      return [status, { items: res.items, total: res.total, hasMore: res.hasMore }] as const;
    }));
    setStatusSections((prev) => ({ ...prev, ...Object.fromEntries(results) }));
  }, [sortBy, filterToParams, filter.statuses]);

  const loadMoreStatusTasks = useCallback(async (status: string) => {
    const res = await window.api.tasks.getActive({
      ...filterToParams(),
      status: [status],
      offset: sectionLoadedRef.current[status] ?? 0,
      limit: getPageSize(),
      sortBy,
    });
    sectionLoadedRef.current[status] = (sectionLoadedRef.current[status] ?? 0) + res.items.length;
    setStatusSections((prev) => ({
      ...prev,
      [status]: {
        items: [...(prev[status]?.items ?? []), ...res.items],
        total: res.total,
        hasMore: res.hasMore,
      },
    }));
  }, [sortBy, filterToParams]);

  // Every caller that refreshed the active list wants the sections in step
  // with it, so the two travel together rather than being wired at each of
  // the fifteen mutation call sites.
  const refreshActiveTasks = useCallback(async () => {
    await Promise.all([refreshActiveList(), refreshStatusSections()]);
  }, [refreshActiveList, refreshStatusSections]);

  const loadMoreActiveTasks = useCallback(async () => {
    const res = await window.api.tasks.getActive({
      offset: activeLoadedRef.current, limit: getPageSize(), sortBy,
      ...filterToParams(),
    });
    activeLoadedRef.current += res.items.length;
    setActiveTasks((prev) => [...prev, ...res.items]);
    setActiveTasksTotal(res.total);
    setActiveTasksHasMore(res.hasMore);
    clearJustCreatedIfPresent(res.items);
  }, [sortBy, filterToParams, clearJustCreatedIfPresent]);

  const loadDoneTasks = useCallback(async () => {
    const res = await window.api.tasks.getDone({
      offset: 0, limit: Math.max(getPageSize(), doneLoadedRef.current), sortBy,
      ...filterToParams(),
    });
    doneLoadedRef.current = res.items.length;
    setDoneTasks(res.items);
    setDoneTasksTotal(res.total);
    setDoneTasksHasMore(res.hasMore);
    setDoneTasksLoaded(true);
    clearJustCreatedIfPresent(res.items);
  }, [sortBy, filterToParams, clearJustCreatedIfPresent]);

  const loadMoreDoneTasks = useCallback(async () => {
    const res = await window.api.tasks.getDone({
      offset: doneLoadedRef.current, limit: getPageSize(), sortBy,
      ...filterToParams(),
    });
    doneLoadedRef.current += res.items.length;
    setDoneTasks((prev) => [...prev, ...res.items]);
    setDoneTasksTotal(res.total);
    setDoneTasksHasMore(res.hasMore);
    clearJustCreatedIfPresent(res.items);
  }, [sortBy, filterToParams, clearJustCreatedIfPresent]);

  // Also refresh the done total count (for badge) even when done tasks aren't loaded
  const refreshDoneCount = useCallback(async () => {
    const res = await window.api.tasks.getDone({
      offset: 0, limit: 0, sortBy,
      ...filterToParams(),
    });
    setDoneTasksTotal(res.total);
  }, [sortBy, filterToParams]);

  // Deleted tasks (recycle bin) loading
  const loadDeletedTasks = useCallback(async () => {
    const res = await window.api.tasks.getDeleted({
      offset: 0, limit: Math.max(getPageSize(), deletedLoadedRef.current),
    });
    deletedLoadedRef.current = res.items.length;
    setDeletedTasks(res.items);
    setDeletedTasksTotal(res.total);
    setDeletedTasksHasMore(res.hasMore);
    setDeletedTasksLoaded(true);
  }, []);

  const loadMoreDeletedTasks = useCallback(async () => {
    const res = await window.api.tasks.getDeleted({ offset: deletedLoadedRef.current, limit: getPageSize() });
    deletedLoadedRef.current += res.items.length;
    setDeletedTasks((prev) => [...prev, ...res.items]);
    setDeletedTasksTotal(res.total);
    setDeletedTasksHasMore(res.hasMore);
  }, []);

  const refreshDeletedCount = useCallback(async () => {
    const res = await window.api.tasks.getDeleted({ offset: 0, limit: 0 });
    setDeletedTasksTotal(res.total);
  }, []);

  // Every mutation that can move a task between sets refreshes the done and
  // deleted lists the same way: refetch when the section is open, otherwise
  // just the count behind its badge. Both were copy-pasted at nine call
  // sites and had already drifted apart at one of them.
  const refreshDone = useCallback(async () => {
    if (doneTasksLoaded) {
      await loadDoneTasks();
    } else {
      await refreshDoneCount();
    }
  }, [doneTasksLoaded, loadDoneTasks, refreshDoneCount]);

  const refreshDeleted = useCallback(async () => {
    if (deletedTasksLoaded) {
      await loadDeletedTasks();
    } else {
      await refreshDeletedCount();
    }
  }, [deletedTasksLoaded, loadDeletedTasks, refreshDeletedCount]);

  const refreshTasks = useCallback(async () => {
    await refreshActiveTasks();
    await refreshDone();
  }, [refreshActiveTasks, refreshDone]);

  const refreshCategories = useCallback(async () => {
    const all = await window.api.categories.getAll();
    setCategories(all);
  }, []);

  useEffect(() => {
    refreshActiveTasks();
    refreshDone();
    refreshDeletedCount();
    refreshCategories();
  }, [refreshActiveTasks, refreshDone, refreshDeletedCount, refreshCategories]);

  // Refresh when CLI or other external process modifies data.
  // Refreshers are stashed in a ref so the subscription doesn't re-bind on
  // every keystroke (filter.search changes recreate refreshActiveTasks). That
  // would also reset the 100ms debounce in flight.
  const refreshersRef = useRef({
    refreshActiveTasks, refreshDone, refreshDeletedCount, refreshCategories,
  });
  refreshersRef.current = {
    refreshActiveTasks, refreshDone, refreshDeletedCount, refreshCategories,
  };
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>;
    const unsubscribe = window.api.onDataChanged(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // The event carries no payload, so an external change of unknown
        // scope has to refresh everything.
        const r = refreshersRef.current;
        r.refreshActiveTasks();
        r.refreshDone();
        r.refreshDeletedCount();
        r.refreshCategories();
      }, 100);
    });
    return () => {
      clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, []);

  const createTask = useCallback(async (input: CreateTaskInput) => {
    const task = await window.api.tasks.create(input);
    // Seed the slot before refreshing: the refresh clears it again if the
    // new task landed inside the loaded pages.
    setJustCreatedTask(task);
    await refreshActiveTasks();
    return task;
  }, [refreshActiveTasks]);

  const updateTask = useCallback(async (id: string, input: UpdateTaskInput) => {
    const task = await window.api.tasks.update(id, input);
    // Status transitions may move tasks between active/done sets
    await refreshActiveTasks();
    await refreshDone();
    return task;
  }, [refreshActiveTasks, refreshDone]);

  const deleteTask = useCallback(async (id: string) => {
    await window.api.tasks.delete(id);
    if (selectedTaskId === id) setSelectedTaskId(null);
    setJustCreatedTask((prev) => (prev?.id === id ? null : prev));
    await refreshActiveTasks();
    await refreshDone();
    await refreshDeleted();
  }, [refreshActiveTasks, refreshDone, refreshDeleted, selectedTaskId]);

  const reorderTasks = useCallback(async (orderedIds: string[]) => {
    await window.api.tasks.reorder(orderedIds);
    await refreshActiveTasks();
  }, [refreshActiveTasks]);

  const createCategory = useCallback(async (input: CreateCategoryInput) => {
    const cat = await window.api.categories.create(input);
    await refreshCategories();
    return cat;
  }, [refreshCategories]);

  const updateCategory = useCallback(async (id: string, updates: UpdateCategoryInput) => {
    const cat = await window.api.categories.update(id, updates);
    await refreshCategories();
    return cat;
  }, [refreshCategories]);

  const selectAllActiveTasks = useCallback(async () => {
    const ids = await window.api.tasks.getActiveIds(filterToParams());
    setSelectedTaskIds(new Set(ids));
  }, [filterToParams]);

  // ─── Batch mode ──────────────────────────────────────────────────────

  const enterBatchMode = useCallback(() => {
    setBatchMode(true);
    setSelectedTaskIds(new Set());
  }, []);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setSelectedTaskIds(new Set());
  }, []);

  const toggleTaskSelection = useCallback((id: string) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllTasks = useCallback((ids: string[]) => {
    setSelectedTaskIds(new Set(ids));
  }, []);

  const deselectAllTasks = useCallback(() => {
    setSelectedTaskIds(new Set());
  }, []);

  const batchUpdateTasks = useCallback(async (input: BatchUpdateInput) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    await window.api.tasks.batchUpdate(ids, input);
    await refreshActiveTasks();
    await refreshDone();
  }, [selectedTaskIds, refreshActiveTasks, refreshDone]);

  const batchMarkSelectedReported = useCallback(async (
    reportedAt: string | null,
    dateRange?: { dateStart?: string; dateEnd?: string },
  ) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return { changed: 0 };
    const result = await window.api.timeEntries.batchMarkReported(ids, {
      reportedAt,
      dateStart: dateRange?.dateStart,
      dateEnd: dateRange?.dateEnd,
    });
    // Reported state is computed on Task rows (unreportedTimeSeconds), so the
    // task list needs a refresh to reflect new unreported badges/totals.
    await refreshActiveTasks();
    await refreshDone();
    return result;
  }, [selectedTaskIds, refreshActiveTasks, refreshDone]);

  const batchDeleteTasks = useCallback(async () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    await window.api.tasks.batchSoftDelete(ids);
    exitBatchMode();
    await refreshActiveTasks();
    await refreshDone();
    await refreshDeleted();
  }, [selectedTaskIds, exitBatchMode, refreshActiveTasks, refreshDone, refreshDeleted]);

  // ─── Recycle bin operations ─────────────────────────────────────────

  const restoreTask = useCallback(async (id: string) => {
    await window.api.tasks.restore(id);
    await refreshActiveTasks();
    await refreshDone();
    await refreshDeleted();
  }, [refreshActiveTasks, refreshDone, refreshDeleted]);

  const batchRestoreTasks = useCallback(async (ids: string[]) => {
    await window.api.tasks.batchRestore(ids);
    await refreshActiveTasks();
    await refreshDone();
    await refreshDeleted();
  }, [refreshActiveTasks, refreshDone, refreshDeleted]);

  const purgeTask = useCallback(async (id: string) => {
    await window.api.tasks.purgeDeleted(id);
    await refreshDeleted();
  }, [refreshDeleted]);

  const emptyRecycleBin = useCallback(async () => {
    await window.api.tasks.emptyRecycleBin();
    deletedLoadedRef.current = 0;
    setDeletedTasks([]);
    setDeletedTasksTotal(0);
    setDeletedTasksHasMore(false);
  }, []);

  const restoreAllDeleted = useCallback(async () => {
    await window.api.tasks.restoreAll();
    deletedLoadedRef.current = 0;
    setDeletedTasks([]);
    setDeletedTasksTotal(0);
    setDeletedTasksHasMore(false);
    await refreshActiveTasks();
    await refreshDone();
  }, [refreshActiveTasks, refreshDone]);

  const resetApp = useCallback(async () => {
    await window.api.tasks.resetApp();
    await refreshActiveTasks();
    deletedLoadedRef.current = 0;
    setDeletedTasks([]);
    setDeletedTasksTotal(0);
    setDeletedTasksHasMore(false);
    setDeletedTasksLoaded(false);
  }, [refreshActiveTasks]);

  const deleteCategory = useCallback(async (id: string) => {
    await window.api.categories.delete(id);
    await refreshCategories();
    await refreshTasks();
  }, [refreshCategories, refreshTasks]);

  const value: TaskContextValue = useMemo(() => ({
    tasks,
    activeTasks,
    activeTasksTotal,
    activeTasksHasMore,
    statusSections,
    loadMoreStatusTasks,
    doneTasks,
    doneTasksTotal,
    doneTasksHasMore,
    doneTasksLoaded,
    deletedTasks,
    deletedTasksTotal,
    deletedTasksHasMore,
    deletedTasksLoaded,
    batchMode,
    selectedTaskIds,
    enterBatchMode,
    exitBatchMode,
    toggleTaskSelection,
    selectAllTasks,
    deselectAllTasks,
    batchUpdateTasks,
    batchDeleteTasks,
    batchMarkSelectedReported,
    loadDeletedTasks,
    loadMoreDeletedTasks,
    restoreTask,
    batchRestoreTasks,
    purgeTask,
    emptyRecycleBin,
    restoreAllDeleted,
    resetApp,
    categories,
    selectedTaskId,
    filter,
    selectTask: setSelectedTaskId,
    setFilter,
    createTask,
    updateTask,
    deleteTask,
    reorderTasks,
    refreshTasks,
    refreshActiveTasks,
    loadMoreActiveTasks,
    loadDoneTasks,
    loadMoreDoneTasks,
    createCategory,
    updateCategory,
    deleteCategory,
    refreshCategories,
    selectAllActiveTasks,
    sortBy,
    setSortBy,
    pendingTimeEntry,
    setPendingTimeEntry,
  }), [
    tasks, activeTasks, activeTasksTotal, activeTasksHasMore,
    statusSections, loadMoreStatusTasks,
    doneTasks, doneTasksTotal, doneTasksHasMore, doneTasksLoaded,
    deletedTasks, deletedTasksTotal, deletedTasksHasMore, deletedTasksLoaded,
    batchMode, selectedTaskIds, enterBatchMode, exitBatchMode,
    toggleTaskSelection, selectAllTasks, deselectAllTasks, batchUpdateTasks,
    batchDeleteTasks, batchMarkSelectedReported, loadDeletedTasks,
    loadMoreDeletedTasks, restoreTask, batchRestoreTasks, purgeTask,
    emptyRecycleBin, restoreAllDeleted, resetApp, categories, selectedTaskId,
    filter, createTask, updateTask, deleteTask, reorderTasks, refreshTasks,
    refreshActiveTasks, loadMoreActiveTasks, loadDoneTasks, loadMoreDoneTasks,
    createCategory, updateCategory, deleteCategory, refreshCategories,
    selectAllActiveTasks, sortBy, setSortBy, pendingTimeEntry,
  ]);

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
