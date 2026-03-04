import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { Database } from './database/database';
import { registerTaskHandlers } from './ipc/taskHandlers';
import { registerTimeEntryHandlers } from './ipc/timeEntryHandlers';
import { registerCommentHandlers } from './ipc/commentHandlers';
import { registerCategoryHandlers } from './ipc/categoryHandlers';
import { registerReportHandlers } from './ipc/reportHandlers';
import { registerImportHandlers } from './ipc/importHandlers';
import { PluginManager } from './plugins/pluginManager';

let mainWindow: BrowserWindow | null = null;
let database: Database;
let pluginManager: PluginManager;

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

  pluginManager = new PluginManager(database);

  registerTaskHandlers(ipcMain, database);
  registerTimeEntryHandlers(ipcMain, database);
  registerCommentHandlers(ipcMain, database);
  registerCategoryHandlers(ipcMain, database);
  registerReportHandlers(ipcMain, database);
  registerImportHandlers(ipcMain, database);

  // Window management IPC handlers
  ipcMain.handle('window:setAlwaysOnTop', (_event, flag: boolean) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(flag);
  });
  ipcMain.handle('window:getAlwaysOnTop', () => {
    return mainWindow?.isAlwaysOnTop() ?? false;
  });

  // Plugin IPC handlers
  ipcMain.handle('plugins:list', () => pluginManager.listPlugins());
  ipcMain.handle('plugins:sync', async (_event, pluginId: string) => {
    return pluginManager.syncPlugin(pluginId);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  database?.close();
});
