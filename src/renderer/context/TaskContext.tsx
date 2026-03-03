import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { Task, Category, CreateTaskInput, UpdateTaskInput, CreateCategoryInput } from '../../shared/types';

const ACTIVE_TASKS_LIMIT = 50;
const DONE_TASKS_LIMIT = 50;

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

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>({});

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
    refreshCategories();
  }, [refreshActiveTasks, refreshDoneCount, refreshCategories]);

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
  }, [refreshActiveTasks, loadDoneTasks, doneTasksLoaded, selectedTaskId, refreshDoneCount]);

  const reorderTasks = useCallback(async (orderedIds: string[]) => {
    await window.api.tasks.reorder(orderedIds);
    await refreshActiveTasks();
  }, [refreshActiveTasks]);

  const createCategory = useCallback(async (input: CreateCategoryInput) => {
    const cat = await window.api.categories.create(input);
    await refreshCategories();
    return cat;
  }, [refreshCategories]);

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
  };

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
