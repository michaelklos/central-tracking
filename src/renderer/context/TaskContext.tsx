import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { Task, Category, CreateTaskInput, UpdateTaskInput, BatchUpdateInput, CreateCategoryInput } from '../../shared/types';

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

  // Recycle bin operations
  loadDeletedTasks(): Promise<void>;
  loadMoreDeletedTasks(): Promise<void>;
  restoreTask(id: string): Promise<void>;
  batchRestoreTasks(ids: string[]): Promise<void>;
  purgeTask(id: string): Promise<void>;
  emptyRecycleBin(): Promise<void>;

  categories: Category[];
  selectedTaskId: string | null;
  filter: TaskFilter;

  selectTask(id: string | null): void;
  setFilter(filter: TaskFilter): void;

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
  deleteCategory(id: string): Promise<void>;
  refreshCategories(): Promise<void>;

  pendingTimeEntry: { startTime: string; endTime: string } | null;
  setPendingTimeEntry(entry: { startTime: string; endTime: string } | null): void;
}

export interface TaskFilter {
  status?: string;
  source?: string;
  categoryId?: string;
  search?: string;
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
  const [filter, setFilter] = useState<TaskFilter>({});
  const [pendingTimeEntry, setPendingTimeEntry] = useState<{ startTime: string; endTime: string } | null>(null);

  // Combined view of all loaded tasks (for TaskDetail lookup by ID)
  const tasks = useMemo(() => [...activeTasks, ...doneTasks], [activeTasks, doneTasks]);

  const refreshActiveTasks = useCallback(async () => {
    const res = await window.api.tasks.getActive({ offset: 0, limit: ACTIVE_TASKS_LIMIT });
    setActiveTasks(res.items);
    setActiveTasksTotal(res.total);
    setActiveTasksHasMore(res.hasMore);
  }, []);

  const loadMoreActiveTasks = useCallback(async () => {
    const res = await window.api.tasks.getActive({ offset: activeTasks.length, limit: ACTIVE_TASKS_LIMIT });
    setActiveTasks((prev) => [...prev, ...res.items]);
    setActiveTasksTotal(res.total);
    setActiveTasksHasMore(res.hasMore);
  }, [activeTasks.length]);

  const loadDoneTasks = useCallback(async () => {
    const res = await window.api.tasks.getDone({ offset: 0, limit: DONE_TASKS_LIMIT });
    setDoneTasks(res.items);
    setDoneTasksTotal(res.total);
    setDoneTasksHasMore(res.hasMore);
    setDoneTasksLoaded(true);
  }, []);

  const loadMoreDoneTasks = useCallback(async () => {
    const res = await window.api.tasks.getDone({ offset: doneTasks.length, limit: DONE_TASKS_LIMIT });
    setDoneTasks((prev) => [...prev, ...res.items]);
    setDoneTasksTotal(res.total);
    setDoneTasksHasMore(res.hasMore);
  }, [doneTasks.length]);

  // Also refresh the done total count (for badge) even when done tasks aren't loaded
  const refreshDoneCount = useCallback(async () => {
    const res = await window.api.tasks.getDone({ offset: 0, limit: 0 });
    setDoneTasksTotal(res.total);
  }, []);

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
    refreshDoneCount();
    refreshDeletedCount();
    refreshCategories();
  }, [refreshActiveTasks, refreshDoneCount, refreshDeletedCount, refreshCategories]);

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
    loadDeletedTasks,
    loadMoreDeletedTasks,
    restoreTask,
    batchRestoreTasks,
    purgeTask,
    emptyRecycleBin,
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
    deleteCategory,
    refreshCategories,
    pendingTimeEntry,
    setPendingTimeEntry,
  };

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
