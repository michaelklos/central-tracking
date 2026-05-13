import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Tasks
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll'),
    getById: (id: string) => ipcRenderer.invoke('tasks:getById', id),
    getActive: (params?: { offset?: number; limit?: number; sortBy?: string }) =>
      ipcRenderer.invoke('tasks:getActive', params),
    getActiveIds: (params?: { search?: string; status?: string; source?: string; categoryId?: string }) =>
      ipcRenderer.invoke('tasks:getActiveIds', params),
    getDone: (params?: { offset?: number; limit?: number; sortBy?: string }) =>
      ipcRenderer.invoke('tasks:getDone', params),
    create: (task: unknown) => ipcRenderer.invoke('tasks:create', task),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('tasks:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke('tasks:reorder', orderedIds),
    batchUpdate: (ids: string[], input: unknown) =>
      ipcRenderer.invoke('tasks:batchUpdate', ids, input),
    batchSoftDelete: (ids: string[]) => ipcRenderer.invoke('tasks:batchSoftDelete', ids),
    getDeleted: (params?: { offset?: number; limit?: number }) =>
      ipcRenderer.invoke('tasks:getDeleted', params),
    restore: (id: string) => ipcRenderer.invoke('tasks:restore', id),
    batchRestore: (ids: string[]) => ipcRenderer.invoke('tasks:batchRestore', ids),
    purgeDeleted: (id: string) => ipcRenderer.invoke('tasks:purgeDeleted', id),
    emptyRecycleBin: () => ipcRenderer.invoke('tasks:emptyRecycleBin'),
    restoreAll: () => ipcRenderer.invoke('tasks:restoreAll'),
    deleteAll: () => ipcRenderer.invoke('tasks:deleteAll'),
    resetApp: () => ipcRenderer.invoke('tasks:resetApp'),
  },

  // Time entries
  timeEntries: {
    getByTask: (taskId: string) => ipcRenderer.invoke('timeEntries:getByTask', taskId),
    getByTaskPaginated: (taskId: string, params?: { offset?: number; limit?: number }) =>
      ipcRenderer.invoke('timeEntries:getByTaskPaginated', taskId, params),
    create: (entry: unknown) => ipcRenderer.invoke('timeEntries:create', entry),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('timeEntries:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('timeEntries:delete', id),
    getActiveEntry: () => ipcRenderer.invoke('timeEntries:getActive'),
    stopActive: () => ipcRenderer.invoke('timeEntries:stopActive'),
    getTodayTotal: () => ipcRenderer.invoke('timeEntries:getTodayTotal'),
    getByDateRange: (start: string, end: string) =>
      ipcRenderer.invoke('timeEntries:getByDateRange', start, end),
    getReport: (start: string, end: string) =>
      ipcRenderer.invoke('timeEntries:getReport', start, end),
    getSummaryReport: (start: string, end: string) =>
      ipcRenderer.invoke('timeEntries:getSummaryReport', start, end),
    getByDateRangeWithTasks: (start: string, end: string) =>
      ipcRenderer.invoke('timeEntries:getByDateRangeWithTasks', start, end),
  },

  // Comments
  comments: {
    getByTask: (taskId: string) => ipcRenderer.invoke('comments:getByTask', taskId),
    create: (comment: unknown) => ipcRenderer.invoke('comments:create', comment),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('comments:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('comments:delete', id),
  },

  // Categories
  categories: {
    getAll: () => ipcRenderer.invoke('categories:getAll'),
    create: (category: unknown) => ipcRenderer.invoke('categories:create', category),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('categories:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('categories:delete', id),
    assignToTask: (taskId: string, categoryIds: string[]) =>
      ipcRenderer.invoke('categories:assignToTask', taskId, categoryIds),
  },

  // Window management
  window: {
    setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:setAlwaysOnTop', flag),
    getAlwaysOnTop: () => ipcRenderer.invoke('window:getAlwaysOnTop'),
  },

  // Reports
  reports: {
    exportCsv: (start: string, end: string) =>
      ipcRenderer.invoke('reports:exportCsv', start, end),
  },

  // Import
  import: {
    selectAndParse: () => ipcRenderer.invoke('import:selectAndParse'),
    execute: (items: unknown[]) => ipcRenderer.invoke('import:execute', items),
  },

  // CLI tool installation (Mac only; Windows handled by NSIS installer)
  cli: {
    isInstalled: () => ipcRenderer.invoke('cli:isInstalled'),
    install: () => ipcRenderer.invoke('cli:install'),
    uninstall: () => ipcRenderer.invoke('cli:uninstall'),
  },

  // Shell utilities
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },

  platform: process.platform,

  // Data change notifications (pushed from main process when CLI makes changes)
  onDataChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('ct:data-changed', handler);
    return () => {
      ipcRenderer.removeListener('ct:data-changed', handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
