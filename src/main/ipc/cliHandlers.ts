import { app, dialog } from 'electron';
import type { IpcMain, BrowserWindow } from 'electron';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// POSIX (mac + linux): symlink in /usr/local/bin (preferred) or ~/.local/bin
// (fallback) → wrapper shell script in userData. macOS install dialog has
// always set this up; the darwin gate is lifted now that the same flow works
// on linux.
const POSIX_PREFERRED = '/usr/local/bin/ct';
const posixFallback = () => path.join(os.homedir(), '.local', 'bin', 'ct');

// Windows: per-user .cmd shim. PATH update goes through PowerShell so the
// change broadcasts (WM_SETTINGCHANGE) and new shells pick it up without a
// logoff.
const winBinDir = () => path.join(os.homedir(), 'AppData', 'Local', 'central-tracking', 'bin');
const winShim   = () => path.join(winBinDir(), 'ct.cmd');

function getWrapperPath(): string {
  return path.join(app.getPath('userData'), 'ct-wrapper.sh');
}

function getCliScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'cli', 'cli', 'main.js');
  }
  // __dirname is dist/main/ipc/ — go up to dist/ then into cli/cli/ (rootDir:src preserved)
  return path.join(__dirname, '..', '..', 'cli', 'cli', 'main.js');
}

// ─── POSIX (mac + linux) ──────────────────────────────────────────────────

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildWrapperScript(): string {
  const electron = shellSingleQuote(process.execPath);
  const cli = shellSingleQuote(getCliScriptPath());
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 ${electron} ${cli} "$@"\n`;
}

function getSymlinkPath(): string {
  try {
    fs.accessSync(path.dirname(POSIX_PREFERRED), fs.constants.W_OK);
    return POSIX_PREFERRED;
  } catch {
    return posixFallback();
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

function installCliPosix(): { ok: boolean; error?: string } {
  try {
    const wrapperPath = getWrapperPath();
    fs.writeFileSync(wrapperPath, buildWrapperScript(), { mode: 0o755 });
    placeSymlink(getSymlinkPath(), wrapperPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function uninstallCliPosix(): { ok: boolean; error?: string } {
  try {
    for (const p of [POSIX_PREFERRED, posixFallback()]) {
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

// ─── Windows ──────────────────────────────────────────────────────────────

function buildWinShim(): string {
  // CRLF line endings — cmd.exe is picky. Quote both paths since
  // process.execPath frequently contains spaces.
  const lines = [
    '@echo off',
    'set ELECTRON_RUN_AS_NODE=1',
    `"${process.execPath}" "${getCliScriptPath()}" %*`,
    '',
  ];
  return lines.join('\r\n');
}

function runPowerShell(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  }).trim();
}

function getUserPath(): string {
  return runPowerShell("[Environment]::GetEnvironmentVariable('PATH','User')");
}

function setUserPath(newValue: string): void {
  // PowerShell single-quote literal — escape embedded single-quotes by
  // doubling. SetEnvironmentVariable broadcasts WM_SETTINGCHANGE so new
  // shells see the update.
  const literal = `'${newValue.replace(/'/g, "''")}'`;
  runPowerShell(`[Environment]::SetEnvironmentVariable('PATH', ${literal}, 'User')`);
}

function ensureWinBinOnUserPath(): void {
  const current = getUserPath();
  const entries = current.split(';').filter(Boolean);
  if (entries.some((e) => e.toLowerCase() === winBinDir().toLowerCase())) return;
  setUserPath([...entries, winBinDir()].join(';'));
}

function installCliWin(): { ok: boolean; error?: string } {
  try {
    if (!fs.existsSync(winBinDir())) fs.mkdirSync(winBinDir(), { recursive: true });
    fs.writeFileSync(winShim(), buildWinShim());
    ensureWinBinOnUserPath();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function uninstallCliWin(): { ok: boolean; error?: string } {
  try {
    if (fs.existsSync(winShim())) fs.unlinkSync(winShim());
    // PATH entry left in place — harmless once the dir is empty. User can
    // clean manually if desired. Reinstall is idempotent thanks to the
    // dedup check in ensureWinBinOnUserPath.
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export function isCliInstalled(): boolean {
  if (process.platform === 'win32') return fs.existsSync(winShim());
  return [POSIX_PREFERRED, posixFallback()].some((p) => {
    try { fs.accessSync(p); return true; } catch { return false; }
  });
}

// Regenerate wrapper with current paths on each launch so the app keeps
// working if its install location changed between updates.
export function refreshCliWrapper(): void {
  if (!isCliInstalled()) return;
  try {
    if (process.platform === 'win32') {
      fs.writeFileSync(winShim(), buildWinShim());
    } else {
      fs.writeFileSync(getWrapperPath(), buildWrapperScript(), { mode: 0o755 });
    }
  } catch {
    // Non-fatal; stale wrapper still works if the app path hasn't changed.
  }
}

export function installCli(): { ok: boolean; error?: string } {
  return process.platform === 'win32' ? installCliWin() : installCliPosix();
}

export function uninstallCli(): { ok: boolean; error?: string } {
  return process.platform === 'win32' ? uninstallCliWin() : uninstallCliPosix();
}

function installDialogDetail(): string {
  const head = 'This lets you control Central Tracking from your terminal. You can change this later in Settings.\n\n';
  switch (process.platform) {
    case 'win32':
      return head + 'Open a new PowerShell or cmd.exe window to use `ct` after installing. Existing shells need to be restarted to see the updated PATH.';
    case 'linux':
      return head + 'If `~/.local/bin` is not on your PATH, add it to your shell rc and reopen your terminal.';
    default:
      return head + 'Open a new terminal window to use `ct` after installing.';
  }
}

export async function maybePromptCliInstall(win: BrowserWindow): Promise<void> {
  if (isCliInstalled()) return;

  const flagPath = path.join(app.getPath('userData'), 'ct-cli-prompted');
  if (fs.existsSync(flagPath)) return;
  fs.writeFileSync(flagPath, '');

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Install CLI Tool',
    message: 'Install the `ct` command-line tool?',
    detail: installDialogDetail(),
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
