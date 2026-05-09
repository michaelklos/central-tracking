import { app, dialog } from 'electron';
import type { IpcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PREFERRED_SYMLINK = '/usr/local/bin/ct';
const FALLBACK_SYMLINK = path.join(os.homedir(), '.local', 'bin', 'ct');

function getWrapperPath(): string {
  return path.join(app.getPath('userData'), 'ct-wrapper.sh');
}

function getCliScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'cli', 'main.js');
  }
  // __dirname is dist/main/ipc/ — go up to dist/ then into cli/
  return path.join(__dirname, '..', '..', 'cli', 'main.js');
}

function buildWrapperScript(): string {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${getCliScriptPath()}" "$@"\n`;
}

function getSymlinkPath(): string {
  try {
    fs.accessSync(path.dirname(PREFERRED_SYMLINK), fs.constants.W_OK);
    return PREFERRED_SYMLINK;
  } catch {
    return FALLBACK_SYMLINK;
  }
}

export function isCliInstalled(): boolean {
  return [PREFERRED_SYMLINK, FALLBACK_SYMLINK].some((p) => {
    try { fs.accessSync(p); return true; } catch { return false; }
  });
}

// Regenerate wrapper with current paths — call on each launch to stay current after updates
export function refreshCliWrapper(): void {
  if (process.platform !== 'darwin') return;
  if (!isCliInstalled()) return;
  try {
    fs.writeFileSync(getWrapperPath(), buildWrapperScript(), { mode: 0o755 });
  } catch {
    // Non-fatal; stale wrapper still works if the app path hasn't changed
  }
}

function placeSymlink(symlinkPath: string, wrapperPath: string): void {
  const binDir = path.dirname(symlinkPath);
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  try { fs.unlinkSync(symlinkPath); } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }

  fs.symlinkSync(wrapperPath, symlinkPath);
}

export function installCli(): { ok: boolean; error?: string } {
  try {
    const wrapperPath = getWrapperPath();
    fs.writeFileSync(wrapperPath, buildWrapperScript(), { mode: 0o755 });
    placeSymlink(getSymlinkPath(), wrapperPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function uninstallCli(): { ok: boolean; error?: string } {
  try {
    for (const p of [PREFERRED_SYMLINK, FALLBACK_SYMLINK]) {
      try { fs.unlinkSync(p); } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    const wrapperPath = getWrapperPath();
    if (fs.existsSync(wrapperPath)) fs.unlinkSync(wrapperPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function maybePromptCliInstall(win: BrowserWindow): Promise<void> {
  if (process.platform !== 'darwin') return;
  if (isCliInstalled()) return;

  const flagPath = path.join(app.getPath('userData'), 'ct-cli-prompted');
  if (fs.existsSync(flagPath)) return;
  fs.writeFileSync(flagPath, '');

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Install CLI Tool',
    message: 'Install the `ct` command-line tool?',
    detail: 'This lets you control Central Tracking from your terminal. You can change this later in Settings.\n\nOpen a new terminal window to use `ct` after installing.',
    buttons: ['Install', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    const result = installCli();
    if (!result.ok) {
      await dialog.showMessageBox(win, {
        type: 'error',
        title: 'CLI Install Failed',
        message: 'Could not install the `ct` command.',
        detail: result.error,
      });
    }
  }
}

export function registerCliHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('cli:isInstalled', () => isCliInstalled());
  ipcMain.handle('cli:install', () => installCli());
  ipcMain.handle('cli:uninstall', () => uninstallCli());
}
