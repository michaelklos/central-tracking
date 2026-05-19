import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { Task, Category, CreateTaskInput, UpdateTaskInput, BatchUpdateInput, CreateCategoryInput, UpdateCategoryInput, TaskSortBy } from '../../shared/types';

const ACTIVE_TASKS_LIMIT = 50;
const DONE_TASKS_LIMIT = 50;
const DELETED_TASKS_LIMIT = 50;

interface TaskContextValue {
  // Legacy — combined view of all loaded tasks (for TaskDetail lookup)
  tasks: Task[];

  // Paginated active tasks
  activeTasks: Task[];
  activeTasksTotal: number;
  activeTasksHasMore: boolean;

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

  const setSortBy = useCallback((s: TaskSortBy) => {
    setSortByState(s);
    try { localStorage.setItem('ct-sort-by', s); } catch { /* ignore */ }
  }, []);

  // Combined view of all loaded tasks (for TaskDetail lookup by ID)
  const tasks = useMemo(() => [...activeTasks, ...doneTasks], [activeTasks, doneTasks]);

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

  const refreshActiveTasks = useCallback(async () => {
    const res = await window.api.tasks.getActive({
      offset: 0, limit: ACTIVE_TASKS_LIMIT, sortBy,
      ...filterToParams(),
    });
    setActiveTasks(res.items);
    setActiveTasksTotal(res.total);
    setActiveTasksHasMore(res.hasMore);
  }, [sortBy, filterToParams]);

  const loadMoreActiveTasks = useCallback(async () => {
    const res = await window.api.tasks.getActive({
      offset: activeTasks.length, limit: ACTIVE_TASKS_LIMIT, sortBy,
      ...filterToParams(),
    });
    setActiveTasks((prev) => [...prev, ...res.items]);
    setActiveTasksTotal(res.total);
    setActiveTasksHasMore(res.hasMore);
  }, [activeTasks.length, sortBy, filterToParams]);

  const loadDoneTasks = useCallback(async () => {
    const res = await window.api.tasks.getDone({
      offset: 0, limit: DONE_TASKS_LIMIT, sortBy,
      ...filterToParams(),
    });
    setDoneTasks(res.items);
    setDoneTasksTotal(res.total);
    setDoneTasksHasMore(res.hasMore);
    setDoneTasksLoaded(true);
  }, [sortBy, filterToParams]);

  const loadMoreDoneTasks = useCallback(async () => {
    const res = await window.api.tasks.getDone({
      offset: doneTasks.length, limit: DONE_TASKS_LIMIT, sortBy,
      ...filterToParams(),
    });
    setDoneTasks((prev) => [...prev, ...res.items]);
    setDoneTasksTotal(res.total);
    setDoneTasksHasMore(res.hasMore);
  }, [doneTasks.length, sortBy, filterToParams]);

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
    const res = await window.api.tasks.getDeleted({ offset: 0, limit: DELETED_TASKS_LIMIT });
    setDeletedTasks(res.items);
    setDeletedTasksTotal(res.total);
    setDeletedTasksHasMore(res.hasMore);
    setDeletedTasksLoaded(true);
  }, []);

  const loadMoreDeletedTasks = useCallback(async () => {
    const res = await window.api.tasks.getDeleted({ offset: deletedTasks.length, limit: DELETED_TASKS_LIMIT });
    setDeletedTasks((prev) => [...prev, ...res.items]);
    setDeletedTasksTotal(res.total);
    setDeletedTasksHasMore(res.hasMore);
  }, [deletedTasks.length]);

  const refreshDeletedCount = useCallback(async () => {
    const res = await window.api.tasks.getDeleted({ offset: 0, limit: 0 });
    setDeletedTasksTotal(res.total);
  }, []);

  const refreshTasks = useCallback(async () => {
    await refreshActiveTasks();
    if (doneTasksLoaded) {
      await loadDoneTasks();
    } else {
      await refreshDoneCount();
    }
  }, [refreshActiveTasks, loadDoneTasks, doneTasksLoaded, refreshDoneCount]);

  const refreshCategories = useCallback(async () => {
    const all = await window.api.categories.getAll();
    setCategories(all);
  }, []);

  useEffect(() => {
    refreshActiveTasks();
    // When done tasks have been loaded, re-fetch them so the visible list reflects
    // current filters; otherwise just refresh the count badge.
    if (doneTasksLoaded) {
      loadDoneTasks();
    } else {
      refreshDoneCount();
    }
    refreshDeletedCount();
    refreshCategories();
  }, [refreshActiveTasks, refreshDoneCount, refreshDeletedCount, refreshCategories, doneTasksLoaded, loadDoneTasks]);

  // Refresh when CLI or other external process modifies data.
  // Refreshers are stashed in a ref so the subscription doesn't re-bind on
  // every keystroke (filter.search changes recreate refreshActiveTasks). That
  // would also reset the 100ms debounce in flight.
  const refreshersRef = useRef({
    refreshActiveTasks, loadDoneTasks, refreshDoneCount, refreshDeletedCount,
    refreshCategories, doneTasksLoaded,
  });
  refreshersRef.current = {
    refreshActiveTasks, loadDoneTasks, refreshDoneCount, refreshDeletedCount,
    refreshCategories, doneTasksLoaded,
  };
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>;
    const unsubscribe = window.api.onDataChanged(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const r = refreshersRef.current;
        r.refreshActiveTasks();
        if (r.doneTasksLoaded) {
          r.loadDoneTasks();
        } else {
          r.refreshDoneCount();
        }
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
    await refreshActiveTasks();
    return task;
  }, [refreshActiveTasks]);

  const updateTask = useCallback(async (id: string, input: UpdateTaskInput) => {
    const task = await window.api.tasks.update(id, input);
    // Status transitions may move tasks between active/done sets
    await refreshActiveTasks();
    if (doneTasksLoaded) {
      await loadDoneTasks();
    } else {
      await refreshDoneCount();
    }
    return task;
  }, [refreshActiveTasks, loadDoneTasks, doneTasksLoaded, refreshDoneCount]);

  const deleteTask = useCallback(async (id: string) => {
    await window.api.tasks.delete(id);
    if (selectedTaskId === id) setSelectedTaskId(null);
    await refreshActiveTasks();
    if (doneTasksLoaded) {
      await loadDoneTasks();
    } else {
      await refreshDoneCount();
    }
    if (deletedTasksLoaded) {
      await loadDeletedTasks();
    } else {
      await refreshDeletedCount();
    }
  }, [refreshActiveTasks, loadDoneTasks, doneTasksLoaded, selectedTaskId, refreshDoneCount, deletedTasksLoaded, loadDeletedTasks, refreshDeletedCount]);

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
    exitBatchMode();
    await refreshActiveTasks();
    if (doneTasksLoaded) {
      await loadDoneTasks();
    } else {
      await refreshDoneCount();
    }
  }, [selectedTaskIds, exitBatchMode, refreshActiveTasks, doneTasksLoaded, loadDoneTasks, refreshDoneCount]);

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
    if (doneTasksLoaded) {
      await loadDoneTasks();
    }
    return result;
  }, [selectedTaskIds, refreshActiveTasks, doneTasksLoaded, loadDoneTasks]);

  const batchDeleteTasks = useCallback(async () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;
    await window.api.tasks.batchSoftDelete(ids);
    exitBatchMode();
    await refreshActiveTasks();
    if (doneTasksLoaded) {
      await loadDoneTasks();
    } else {
      await refreshDoneCount();
    }
    if (deletedTasksLoaded) {
      await loadDeletedTasks();
    } else {
      await refreshDeletedCount();
    }
  }, [selectedTaskIds, exitBatchMode, refreshActiveTasks, doneTasksLoaded, loadDoneTasks, refreshDoneCount, deletedTasksLoaded, loadDeletedTasks, refreshDeletedCount]);

  // ─── Recycle bin operations ─────────────────────────────────────────

  const restoreTask = useCallback(async (id: string) => {
    await window.api.tasks.restore(id);
    await refreshActiveTasks();
    if (doneTasksLoaded) {
      await loadDoneTasks();
    } else {
      await refreshDoneCount();
    }
    if (deletedTasksLoaded) {
      await loadDeletedTasks();
    } else {
      await refreshDeletedCount();
    }
  }, [refreshActiveTasks, doneTasksLoaded, loadDoneTasks, refreshDoneCount, deletedTasksLoaded, loadDeletedTasks, refreshDeletedCount]);

  const batchRestoreTasks = useCallback(async (ids: string[]) => {
    await window.api.tasks.batchRestore(ids);
    await refreshActiveTasks();
    if (doneTasksLoaded) {
      await loadDoneTasks();
    } else {
      await refreshDoneCount();
    }
    if (deletedTasksLoaded) {
      await loadDeletedTasks();
    } else {
      await refreshDeletedCount();
    }
  }, [refreshActiveTasks, doneTasksLoaded, loadDoneTasks, refreshDoneCount, deletedTasksLoaded, loadDeletedTasks, refreshDeletedCount]);

  const purgeTask = useCallback(async (id: string) => {
    await window.api.tasks.purgeDeleted(id);
    if (deletedTasksLoaded) {
      await loadDeletedTasks();
    } else {
      await refreshDeletedCount();
    }
  }, [deletedTasksLoaded, loadDeletedTasks, refreshDeletedCount]);

  const emptyRecycleBin = useCallback(async () => {
    await window.api.tasks.emptyRecycleBin();
    setDeletedTasks([]);
    setDeletedTasksTotal(0);
    setDeletedTasksHasMore(false);
  }, []);

  const restoreAllDeleted = useCallback(async () => {
    await window.api.tasks.restoreAll();
    setDeletedTasks([]);
    setDeletedTasksTotal(0);
    setDeletedTasksHasMore(false);
    await refreshActiveTasks();
    if (doneTasksLoaded) await loadDoneTasks();
  }, [refreshActiveTasks, doneTasksLoaded, loadDoneTasks]);

  const resetApp = useCallback(async () => {
    await window.api.tasks.resetApp();
    await refreshActiveTasks();
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

  const value: TaskContextValue = {
    tasks,
    activeTasks,
    activeTasksTotal,
    activeTasksHasMore,
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
  };

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
