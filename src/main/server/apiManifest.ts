import type { Database } from '../database/database';

import {
  getAllTasks, getTaskById, getActiveTasks, getDoneTasks,
  createTask, updateTask, deleteTask, reorderTasks,
  batchUpdateTasks, batchSoftDeleteTasks, getDeletedTasks,
  restoreTask, batchRestoreTasks, purgeDeletedTask, emptyRecycleBin,
} from '../ipc/taskHandlers';

import {
  getTimeEntriesByTask, getTimeEntriesByTaskPaginated,
  createTimeEntry, updateTimeEntry, deleteTimeEntry,
  getActiveTimeEntry, stopActiveTimeEntry, getTodayTotal,
  getTimeEntriesByDateRange, getTimeEntryReport, getSummaryReport,
  getTimeEntriesByDateRangeWithTasks,
} from '../ipc/timeEntryHandlers';

import {
  getCommentsByTask, createComment, updateComment, deleteComment,
} from '../ipc/commentHandlers';

import {
  getAllCategories, createCategory, updateCategory, deleteCategory, assignCategoriesToTask,
} from '../ipc/categoryHandlers';

import { generateCsvContent } from '../reports/csvGenerator';
import { parseImportContent, executeImport } from '../import/importExecutor';

import {
  installPlugin, uninstallPlugin, listPlugins, getPlugin, setPluginEnabled,
  getPluginConfig, setPluginConfig, deletePluginConfig, listPluginConfig,
} from '../ipc/pluginHandlers';

export type ApiHandler = (db: Database, ...args: unknown[]) => unknown;

export interface ApiRoute {
  /** HTTP route key in "domain/operation" form (matches `/api/${route}`). */
  route: string;
  /** Matching IPC channel in "domain:operation" form, or `null` for routes that have no IPC binding. */
  ipcChannel: string | null;
  /** Handler function bound to the database. */
  handler: ApiHandler;
  /** True if this operation changes state — triggers UI refresh and (future) plugin events. */
  mutates: boolean;
  /** Optional event name emitted on mutation (consumed by plugin webhooks in Phase 4). */
  event?: string;
}

export const apiManifest: readonly ApiRoute[] = [
  // Tasks
  { route: 'tasks/getAll',           ipcChannel: 'tasks:getAll',           mutates: false, handler: (db) => getAllTasks(db) },
  { route: 'tasks/getById',          ipcChannel: 'tasks:getById',          mutates: false, handler: (db, id) => getTaskById(db, id as string) },
  { route: 'tasks/getActive',        ipcChannel: 'tasks:getActive',        mutates: false, handler: (db, params) => getActiveTasks(db, params as never) },
  { route: 'tasks/getDone',          ipcChannel: 'tasks:getDone',          mutates: false, handler: (db, params) => getDoneTasks(db, params as never) },
  { route: 'tasks/create',           ipcChannel: 'tasks:create',           mutates: true,  event: 'task.created',   handler: (db, input) => createTask(db, input as never) },
  { route: 'tasks/update',           ipcChannel: 'tasks:update',           mutates: true,  event: 'task.updated',   handler: (db, id, updates) => updateTask(db, id as string, updates as never) },
  { route: 'tasks/delete',           ipcChannel: 'tasks:delete',           mutates: true,  event: 'task.deleted',   handler: (db, id) => deleteTask(db, id as string) },
  { route: 'tasks/reorder',          ipcChannel: 'tasks:reorder',          mutates: true,  event: 'task.reordered', handler: (db, ids) => reorderTasks(db, ids as string[]) },
  { route: 'tasks/batchUpdate',      ipcChannel: 'tasks:batchUpdate',      mutates: true,  event: 'task.updated',   handler: (db, ids, input) => batchUpdateTasks(db, ids as string[], input as never) },
  { route: 'tasks/batchSoftDelete',  ipcChannel: 'tasks:batchSoftDelete',  mutates: true,  event: 'task.deleted',   handler: (db, ids) => batchSoftDeleteTasks(db, ids as string[]) },
  { route: 'tasks/getDeleted',       ipcChannel: 'tasks:getDeleted',       mutates: false, handler: (db, params) => getDeletedTasks(db, params as never) },
  { route: 'tasks/restore',          ipcChannel: 'tasks:restore',          mutates: true,  event: 'task.restored',  handler: (db, id) => restoreTask(db, id as string) },
  { route: 'tasks/batchRestore',     ipcChannel: 'tasks:batchRestore',     mutates: true,  event: 'task.restored',  handler: (db, ids) => batchRestoreTasks(db, ids as string[]) },
  { route: 'tasks/purgeDeleted',     ipcChannel: 'tasks:purgeDeleted',     mutates: true,  event: 'task.purged',    handler: (db, id) => purgeDeletedTask(db, id as string) },
  { route: 'tasks/emptyRecycleBin',  ipcChannel: 'tasks:emptyRecycleBin',  mutates: true,  event: 'task.purged',    handler: (db) => emptyRecycleBin(db) },

  // Time entries
  { route: 'timeEntries/getByTask',               ipcChannel: 'timeEntries:getByTask',               mutates: false, handler: (db, taskId) => getTimeEntriesByTask(db, taskId as string) },
  { route: 'timeEntries/getByTaskPaginated',      ipcChannel: 'timeEntries:getByTaskPaginated',      mutates: false, handler: (db, taskId, params) => getTimeEntriesByTaskPaginated(db, taskId as string, params as never) },
  { route: 'timeEntries/create',                  ipcChannel: 'timeEntries:create',                  mutates: true,  event: 'timeEntry.created', handler: (db, input) => createTimeEntry(db, input as never) },
  { route: 'timeEntries/update',                  ipcChannel: 'timeEntries:update',                  mutates: true,  event: 'timeEntry.updated', handler: (db, id, updates) => updateTimeEntry(db, id as string, updates as never) },
  { route: 'timeEntries/delete',                  ipcChannel: 'timeEntries:delete',                  mutates: true,  event: 'timeEntry.deleted', handler: (db, id) => deleteTimeEntry(db, id as string) },
  { route: 'timeEntries/getActive',               ipcChannel: 'timeEntries:getActive',               mutates: false, handler: (db) => getActiveTimeEntry(db) },
  { route: 'timeEntries/stopActive',              ipcChannel: 'timeEntries:stopActive',              mutates: true,  event: 'timeEntry.stopped', handler: (db) => stopActiveTimeEntry(db) },
  { route: 'timeEntries/getTodayTotal',           ipcChannel: 'timeEntries:getTodayTotal',           mutates: false, handler: (db) => getTodayTotal(db) },
  { route: 'timeEntries/getByDateRange',          ipcChannel: 'timeEntries:getByDateRange',          mutates: false, handler: (db, start, end) => getTimeEntriesByDateRange(db, start as string, end as string) },
  { route: 'timeEntries/getReport',               ipcChannel: 'timeEntries:getReport',               mutates: false, handler: (db, start, end) => getTimeEntryReport(db, start as string, end as string) },
  { route: 'timeEntries/getSummaryReport',        ipcChannel: 'timeEntries:getSummaryReport',        mutates: false, handler: (db, start, end) => getSummaryReport(db, start as string, end as string) },
  { route: 'timeEntries/getByDateRangeWithTasks', ipcChannel: 'timeEntries:getByDateRangeWithTasks', mutates: false, handler: (db, start, end) => getTimeEntriesByDateRangeWithTasks(db, start as string, end as string) },

  // Comments
  { route: 'comments/getByTask', ipcChannel: 'comments:getByTask', mutates: false, handler: (db, taskId) => getCommentsByTask(db, taskId as string) },
  { route: 'comments/create',    ipcChannel: 'comments:create',    mutates: true,  event: 'comment.created', handler: (db, input) => createComment(db, input as never) },
  { route: 'comments/update',    ipcChannel: 'comments:update',    mutates: true,  event: 'comment.updated', handler: (db, id, updates) => updateComment(db, id as string, updates as never) },
  { route: 'comments/delete',    ipcChannel: 'comments:delete',    mutates: true,  event: 'comment.deleted', handler: (db, id) => deleteComment(db, id as string) },

  // Categories
  { route: 'categories/getAll',       ipcChannel: 'categories:getAll',       mutates: false, handler: (db) => getAllCategories(db) },
  { route: 'categories/create',       ipcChannel: 'categories:create',       mutates: true,  event: 'category.created',  handler: (db, input) => createCategory(db, input as never) },
  { route: 'categories/update',       ipcChannel: 'categories:update',       mutates: true,  event: 'category.updated',  handler: (db, id, updates) => updateCategory(db, id as string, updates as never) },
  { route: 'categories/delete',       ipcChannel: 'categories:delete',       mutates: true,  event: 'category.deleted',  handler: (db, id) => deleteCategory(db, id as string) },
  { route: 'categories/assignToTask', ipcChannel: 'categories:assignToTask', mutates: true,  event: 'category.assigned', handler: (db, taskId, catIds) => assignCategoriesToTask(db, taskId as string, catIds as string[]) },

  // Reports — HTTP serves the pure content generator; the `reports:exportCsv` IPC wraps it in a save dialog (UI-only, no CLI route).
  { route: 'reports/generateCsv', ipcChannel: null, mutates: false, handler: (db, start, end) => generateCsvContent(db, start as string, end as string) },

  // Import — HTTP uses the pure content parser; the `import:selectAndParse` IPC is UI-only (opens file dialog).
  { route: 'import/parseContent', ipcChannel: null,             mutates: false, handler: (db, content) => parseImportContent(db, content as string) },
  { route: 'import/execute',      ipcChannel: 'import:execute', mutates: true,  event: 'import.executed', handler: (db, items) => executeImport(db, items as never[]) },

  // Plugins — CLI-only surface (no IPC, no UI). Webhook dispatch reads from the plugins table.
  { route: 'plugins/list',         ipcChannel: null, mutates: false, handler: (db) => listPlugins(db) },
  { route: 'plugins/get',          ipcChannel: null, mutates: false, handler: (db, id) => getPlugin(db, id as string) },
  { route: 'plugins/install',      ipcChannel: null, mutates: true,  event: 'plugin.installed',   handler: (db, manifest) => installPlugin(db, manifest) },
  { route: 'plugins/uninstall',    ipcChannel: null, mutates: true,  event: 'plugin.uninstalled', handler: (db, id) => uninstallPlugin(db, id as string) },
  { route: 'plugins/setEnabled',   ipcChannel: null, mutates: true,  event: 'plugin.updated',     handler: (db, id, enabled) => setPluginEnabled(db, id as string, enabled as boolean) },
  { route: 'plugins/getConfig',    ipcChannel: null, mutates: false, handler: (db, id, key) => getPluginConfig(db, id as string, key as string) },
  { route: 'plugins/listConfig',   ipcChannel: null, mutates: false, handler: (db, id) => listPluginConfig(db, id as string) },
  { route: 'plugins/setConfig',    ipcChannel: null, mutates: true,  event: 'plugin.configChanged', handler: (db, id, key, value) => setPluginConfig(db, id as string, key as string, value as string) },
  { route: 'plugins/deleteConfig', ipcChannel: null, mutates: true,  event: 'plugin.configChanged', handler: (db, id, key) => deletePluginConfig(db, id as string, key as string) },
];

/** Route key (e.g. "tasks/getAll") → route entry. Used by the HTTP server. */
export function buildRouteMap(manifest: readonly ApiRoute[] = apiManifest): Record<string, ApiRoute> {
  const map: Record<string, ApiRoute> = {};
  for (const entry of manifest) {
    if (map[entry.route]) throw new Error(`Duplicate manifest route: ${entry.route}`);
    map[entry.route] = entry;
  }
  return map;
}
