import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Database } from './database/database';
import { registerTaskHandlers } from './ipc/taskHandlers';
import { registerTimeEntryHandlers } from './ipc/timeEntryHandlers';
import { registerCommentHandlers } from './ipc/commentHandlers';
import { registerCategoryHandlers } from './ipc/categoryHandlers';
import { registerReportHandlers } from './ipc/reportHandlers';
import { registerImportHandlers } from './ipc/importHandlers';
import { registerCliHandlers, refreshCliWrapper, maybePromptCliInstall } from './ipc/cliHandlers';
import { startDisplayKeepalive, stopDisplayKeepalive } from './displayKeepalive';
import { startHttpServer, type HttpServerInstance } from './server/httpServer';
import { initLogFile, log } from './logger';

// Ensure consistent userData path in both dev and packaged modes
app.setName('central-tracking');

// Prevent the GPU compositor from blanking the renderer on Windows
app.disableHardwareAcceleration();

let keepaliveEnabled = false;

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
    autoHideMenuBar: true,
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

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error(`Renderer process gone — reason: ${details.reason}, exitCode: ${details.exitCode}`);
    if (details.reason !== 'clean-exit') {
      log.info('Reloading renderer after crash');
      if (process.env.NODE_ENV === 'development') {
        mainWindow?.loadURL('http://localhost:3000');
      } else {
        mainWindow?.loadFile(path.join(__dirname, '../renderer/index.html'));
      }
    }
  });
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  initLogFile(path.join(userDataPath, 'central-tracking.log'));

  try {
    const prefsPath = path.join(userDataPath, 'preferences.json');
    if (fs.existsSync(prefsPath)) {
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        keepaliveEnabled = prefs?.keepDisplayAwake === true;
      } catch (err) {
        // File exists but is malformed — warn so the user notices instead of
        // silently disabling preferences. Keep the message generic; the
        // surrounding feature is deliberately low-profile.
        log.warn('preferences.json is unreadable or malformed; using defaults.', String(err));
      }
    }
  } catch {
    // unexpected — leave defaults
  }

  const dbPath = path.join(userDataPath, 'central-tracking.db');
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
    if (keepaliveEnabled) flag ? startDisplayKeepalive() : stopDisplayKeepalive();
  });
  ipcMain.handle('window:getAlwaysOnTop', () => {
    return mainWindow?.isAlwaysOnTop() ?? false;
  });
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    // Restrict to http(s) to prevent a compromised renderer from invoking
    // file://, javascript:, or other dangerous URL schemes via the shell.
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        log.warn(`Refusing to open external URL with unsupported protocol: ${parsed.protocol}`);
        return;
      }
    } catch {
      log.warn(`Refusing to open external URL: malformed input`);
      return;
    }
    shell.openExternal(url);
  });

  // Renderer log forwarding: renderer sends errors here to persist them in the log file
  ipcMain.on('log:renderer', (_event, level: string, message: string) => {
    if (level === 'error') log.error('[RENDERER]', message);
    else log.warn('[RENDERER]', message);
  });

  // Start HTTP server for CLI access
  startHttpServer(database, userDataPath, () => mainWindow).then((server) => {
    httpServer = server;
    log.info(`CLI server listening on port ${server.port}`);
  }).catch((err) => {
    log.error('Failed to start CLI server:', String(err));
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
