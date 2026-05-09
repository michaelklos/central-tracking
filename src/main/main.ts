import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { Database } from './database/database';
import { registerTaskHandlers } from './ipc/taskHandlers';
import { registerTimeEntryHandlers } from './ipc/timeEntryHandlers';
import { registerCommentHandlers } from './ipc/commentHandlers';
import { registerCategoryHandlers } from './ipc/categoryHandlers';
import { registerReportHandlers } from './ipc/reportHandlers';
import { registerImportHandlers } from './ipc/importHandlers';
import { registerCliHandlers, refreshCliWrapper, maybePromptCliInstall } from './ipc/cliHandlers';
import { startMouseMover, stopMouseMover } from './activityMonitor';
import { startHttpServer, type HttpServerInstance } from './server/httpServer';

const mmEnabled = process.argv.includes('--mm');

let mainWindow: BrowserWindow | null = null;
let database: Database;
let httpServer: HttpServerInstance | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Central Tracking',
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'central-tracking.db');
  database = new Database(dbPath);

  registerTaskHandlers(ipcMain, database);
  registerTimeEntryHandlers(ipcMain, database);
  registerCommentHandlers(ipcMain, database);
  registerCategoryHandlers(ipcMain, database);
  registerReportHandlers(ipcMain, database);
  registerImportHandlers(ipcMain, database);
  registerCliHandlers(ipcMain);
  refreshCliWrapper();

  // Auto-purge tasks deleted more than 30 days ago
  database.instance.prepare(
    "DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')"
  ).run();

  // Window management IPC handlers
  ipcMain.handle('window:setAlwaysOnTop', (_event, flag: boolean) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(flag);
    if (mmEnabled) flag ? startMouseMover() : stopMouseMover();
  });
  ipcMain.handle('window:getAlwaysOnTop', () => {
    return mainWindow?.isAlwaysOnTop() ?? false;
  });

  // Start HTTP server for CLI access
  const userDataPath = app.getPath('userData');
  startHttpServer(database, userDataPath, () => mainWindow).then((server) => {
    httpServer = server;
    console.log(`CLI server listening on port ${server.port}`);
  }).catch((err) => {
    console.error('Failed to start CLI server:', err);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  mainWindow!.webContents.once('did-finish-load', () => {
    if (mainWindow) maybePromptCliInstall(mainWindow);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  httpServer?.close();
  database?.close();
});
