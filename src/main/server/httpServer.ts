import * as http from 'http';
import type { Database } from '../database/database';
import type { BrowserWindow } from 'electron';
import { generateToken, writeServerFile, removeServerFile, isValidToken, isValidHost } from './auth';

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

const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const DEFAULT_PORT = 19532;
const MAX_PORT_ATTEMPTS = 5;

type HandlerFn = (db: Database, ...args: unknown[]) => unknown;

interface RouteEntry {
  handler: HandlerFn;
  mutates: boolean;
}

// Route table mapping "domain/operation" to handler functions
function buildRouteTable(): Record<string, RouteEntry> {
  return {
    // Tasks
    'tasks/getAll': { handler: (db) => getAllTasks(db), mutates: false },
    'tasks/getById': { handler: (db, id) => getTaskById(db, id as string), mutates: false },
    'tasks/getActive': { handler: (db, params) => getActiveTasks(db, params as never), mutates: false },
    'tasks/getDone': { handler: (db, params) => getDoneTasks(db, params as never), mutates: false },
    'tasks/create': { handler: (db, input) => createTask(db, input as never), mutates: true },
    'tasks/update': { handler: (db, id, updates) => updateTask(db, id as string, updates as never), mutates: true },
    'tasks/delete': { handler: (db, id) => deleteTask(db, id as string), mutates: true },
    'tasks/reorder': { handler: (db, ids) => reorderTasks(db, ids as string[]), mutates: true },
    'tasks/batchUpdate': { handler: (db, ids, input) => batchUpdateTasks(db, ids as string[], input as never), mutates: true },
    'tasks/batchSoftDelete': { handler: (db, ids) => batchSoftDeleteTasks(db, ids as string[]), mutates: true },
    'tasks/getDeleted': { handler: (db, params) => getDeletedTasks(db, params as never), mutates: false },
    'tasks/restore': { handler: (db, id) => restoreTask(db, id as string), mutates: true },
    'tasks/batchRestore': { handler: (db, ids) => batchRestoreTasks(db, ids as string[]), mutates: true },
    'tasks/purgeDeleted': { handler: (db, id) => purgeDeletedTask(db, id as string), mutates: true },
    'tasks/emptyRecycleBin': { handler: (db) => emptyRecycleBin(db), mutates: true },

    // Time entries
    'timeEntries/getByTask': { handler: (db, taskId) => getTimeEntriesByTask(db, taskId as string), mutates: false },
    'timeEntries/getByTaskPaginated': { handler: (db, taskId, params) => getTimeEntriesByTaskPaginated(db, taskId as string, params as never), mutates: false },
    'timeEntries/create': { handler: (db, input) => createTimeEntry(db, input as never), mutates: true },
    'timeEntries/update': { handler: (db, id, updates) => updateTimeEntry(db, id as string, updates as never), mutates: true },
    'timeEntries/delete': { handler: (db, id) => deleteTimeEntry(db, id as string), mutates: true },
    'timeEntries/getActive': { handler: (db) => getActiveTimeEntry(db), mutates: false },
    'timeEntries/stopActive': { handler: (db) => stopActiveTimeEntry(db), mutates: true },
    'timeEntries/getTodayTotal': { handler: (db) => getTodayTotal(db), mutates: false },
    'timeEntries/getByDateRange': { handler: (db, start, end) => getTimeEntriesByDateRange(db, start as string, end as string), mutates: false },
    'timeEntries/getReport': { handler: (db, start, end) => getTimeEntryReport(db, start as string, end as string), mutates: false },
    'timeEntries/getSummaryReport': { handler: (db, start, end) => getSummaryReport(db, start as string, end as string), mutates: false },
    'timeEntries/getByDateRangeWithTasks': { handler: (db, start, end) => getTimeEntriesByDateRangeWithTasks(db, start as string, end as string), mutates: false },

    // Comments
    'comments/getByTask': { handler: (db, taskId) => getCommentsByTask(db, taskId as string), mutates: false },
    'comments/create': { handler: (db, input) => createComment(db, input as never), mutates: true },
    'comments/update': { handler: (db, id, updates) => updateComment(db, id as string, updates as never), mutates: true },
    'comments/delete': { handler: (db, id) => deleteComment(db, id as string), mutates: true },

    // Categories
    'categories/getAll': { handler: (db) => getAllCategories(db), mutates: false },
    'categories/create': { handler: (db, input) => createCategory(db, input as never), mutates: true },
    'categories/update': { handler: (db, id, updates) => updateCategory(db, id as string, updates as never), mutates: true },
    'categories/delete': { handler: (db, id) => deleteCategory(db, id as string), mutates: true },
    'categories/assignToTask': { handler: (db, taskId, catIds) => assignCategoriesToTask(db, taskId as string, catIds as string[]), mutates: true },

    // Reports
    'reports/generateCsv': { handler: (db, start, end) => generateCsvContent(db, start as string, end as string), mutates: false },

    // Import
    'import/parseContent': { handler: (db, content) => parseImportContent(db, content as string), mutates: false },
    'import/execute': { handler: (db, items) => executeImport(db, items as never[]), mutates: true },
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export interface HttpServerInstance {
  port: number;
  token: string;
  close(): Promise<void>;
}

export async function startHttpServer(
  db: Database,
  userDataPath: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<HttpServerInstance> {
  const token = generateToken();
  const routes = buildRouteTable();

  const server = http.createServer(async (req, res) => {
    // Drain request body before sending any error response to avoid ECONNRESET
    const bodyStr = await readBody(req);

    // Only accept POST to /api/*
    if (req.method !== 'POST' || !req.url?.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }

    // Host header validation (DNS rebinding protection)
    if (!isValidHost(req, actualPort)) {
      sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Invalid host' } });
      return;
    }

    // Token auth
    if (!isValidToken(req, token)) {
      sendJson(res, 401, { ok: false, error: { code: 'AUTH_FAILED', message: 'Invalid or missing token' } });
      return;
    }

    // Parse route: /api/domain/operation → "domain/operation"
    const routeKey = req.url.slice(5); // Remove "/api/"
    const route = routes[routeKey];

    if (!route) {
      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `Unknown endpoint: ${routeKey}` } });
      return;
    }

    try {
      const { args = [] } = bodyStr ? JSON.parse(bodyStr) : {};

      const result = route.handler(db, ...args);

      sendJson(res, 200, { ok: true, data: result });

      // Notify renderer of data changes for mutating operations
      if (route.mutates) {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('ct:data-changed');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.includes('not found') ? 'NOT_FOUND' : 'INTERNAL';
      sendJson(res, code === 'NOT_FOUND' ? 404 : 500, {
        ok: false,
        error: { code, message },
      });
    }
  });

  let actualPort = DEFAULT_PORT;

  // Try to bind to port, incrementing on conflict
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(actualPort, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      break; // Success
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'EADDRINUSE') {
        actualPort++;
        if (attempt === MAX_PORT_ATTEMPTS - 1) {
          throw new Error(`Could not find available port (tried ${DEFAULT_PORT}-${actualPort})`);
        }
      } else {
        throw err;
      }
    }
  }

  // Write server discovery file
  writeServerFile(userDataPath, { port: actualPort, token, pid: process.pid });

  return {
    port: actualPort,
    token,
    close(): Promise<void> {
      return new Promise((resolve) => {
        removeServerFile(userDataPath);
        server.close(() => resolve());
      });
    },
  };
}
