import { app, dialog } from 'electron';
import type { IpcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const SYMLINK_PATH = '/usr/local/bin/ct';

function getWrapperPath(): string {
  return path.join(app.getPath('userData'), 'ct-wrapper.sh');
}

function getCliScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'cli', 'main.js');
  }
  return path.join(app.getAppPath(), 'dist', 'cli', 'main.js');
}

function buildWrapperScript(): string {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${getCliScriptPath()}" "$@"\n`;
}

export function isCliInstalled(): boolean {
  try {
    fs.accessSync(SYMLINK_PATH);
    return true;
  } catch {
    return false;
  }
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

export function installCli(): { ok: boolean; error?: string } {
  try {
    const wrapperPath = getWrapperPath();
    fs.writeFileSync(wrapperPath, buildWrapperScript(), { mode: 0o755 });

    const binDir = path.dirname(SYMLINK_PATH);
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    if (fs.existsSync(SYMLINK_PATH) || fs.lstatSync(SYMLINK_PATH).isSymbolicLink()) {
      fs.unlinkSync(SYMLINK_PATH);
    }

    fs.symlinkSync(wrapperPath, SYMLINK_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function uninstallCli(): { ok: boolean; error?: string } {
  try {
    if (fs.existsSync(SYMLINK_PATH) || isSymlinkBroken(SYMLINK_PATH)) {
      fs.unlinkSync(SYMLINK_PATH);
    }
    const wrapperPath = getWrapperPath();
    if (fs.existsSync(wrapperPath)) {
      fs.unlinkSync(wrapperPath);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function isSymlinkBroken(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
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
    detail: 'This lets you control Central Tracking from your terminal. You can change this later in Settings.',
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
