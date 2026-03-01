import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Task, Category, CreateTaskInput, UpdateTaskInput, CreateCategoryInput } from '../../shared/types';

interface TaskContextValue {
  tasks: Task[];
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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>({});

  const refreshTasks = useCallback(async () => {
    const all = await window.api.tasks.getAll();
    setTasks(all);
  }, []);

  const refreshCategories = useCallback(async () => {
    const all = await window.api.categories.getAll();
    setCategories(all);
  }, []);

  useEffect(() => {
    refreshTasks();
    refreshCategories();
  }, [refreshTasks, refreshCategories]);

  const createTask = useCallback(async (input: CreateTaskInput) => {
    const task = await window.api.tasks.create(input);
    await refreshTasks();
    return task;
  }, [refreshTasks]);

  const updateTask = useCallback(async (id: string, input: UpdateTaskInput) => {
    const task = await window.api.tasks.update(id, input);
    await refreshTasks();
    return task;
  }, [refreshTasks]);

  const deleteTask = useCallback(async (id: string) => {
    await window.api.tasks.delete(id);
    if (selectedTaskId === id) setSelectedTaskId(null);
    await refreshTasks();
  }, [refreshTasks, selectedTaskId]);

  const reorderTasks = useCallback(async (orderedIds: string[]) => {
    await window.api.tasks.reorder(orderedIds);
    await refreshTasks();
  }, [refreshTasks]);

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
    createCategory,
    deleteCategory,
    refreshCategories,
  };

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
