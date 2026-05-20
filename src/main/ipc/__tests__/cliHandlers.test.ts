import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// State referenced by hoisted vi.mock factories.
const harness = vi.hoisted(() => ({
  isPackaged: true,
  userDataDir: '',
  homeDir: '',
  psCalls: [] as string[][],
  userPathReturn: '',
}));

// os.homedir() is non-configurable in ESM and Node's implementation reads
// from passwd, not HOME/USERPROFILE — so we can't redirect homedir for tests.
// Instead, test paths are computed against the real homedir at runtime, and
// the test cleans up its own .cmd shim afterwards.
function expectedWinBinDir(): string {
  return path.join(os.homedir(), 'AppData', 'Local', 'central-tracking', 'bin');
}
function expectedWinShim(): string {
  return path.join(expectedWinBinDir(), 'ct.cmd');
}

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return harness.userDataDir;
      throw new Error(`unexpected app.getPath: ${key}`);
    },
    get isPackaged() { return harness.isPackaged; },
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

vi.mock('child_process', () => {
  // runPowerShell calls `.trim()` on the result, so return a string when
  // encoding is requested (utf8). All cliHandlers calls pass {encoding:'utf8'},
  // so always returning a string matches reality.
  const execFileSync = (cmd: string, args: string[]) => {
    harness.psCalls.push([cmd, ...args]);
    if (args.some((a) => a.includes('GetEnvironmentVariable'))) {
      return harness.userPathReturn;
    }
    return '';
  };
  return { execFileSync, default: { execFileSync } };
});

import {
  installCli, uninstallCli, isCliInstalled, refreshCliWrapper,
} from '../cliHandlers';

const ORIG_PLATFORM = process.platform;
const ORIG_EXEC_PATH = process.execPath;

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

function setExecPath(p: string): void {
  Object.defineProperty(process, 'execPath', { value: p, configurable: true });
}

describe('cliHandlers', () => {
  beforeEach(() => {
    harness.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cli-'));
    harness.isPackaged = true;
    harness.psCalls.length = 0;
    harness.userPathReturn = '';
  });

  afterEach(() => {
    fs.rmSync(harness.userDataDir, { recursive: true, force: true });
    setPlatform(ORIG_PLATFORM);
    setExecPath(ORIG_EXEC_PATH);
    // Clean up real-homedir-rooted artifacts the Windows branch writes.
    try { fs.unlinkSync(expectedWinShim()); } catch { /* not all tests install */ }
    try { fs.rmdirSync(expectedWinBinDir()); } catch { /* may still have other files */ }
  });

  describe('Windows', () => {
    const ORIG_RESOURCES_PATH = process.resourcesPath;
    beforeEach(() => {
      setPlatform('win32');
      setExecPath('C:\\Program Files\\Central Tracking\\Central Tracking.exe');
      Object.defineProperty(process, 'resourcesPath', {
        value: 'C:\\Program Files\\Central Tracking\\resources',
        configurable: true,
      });
    });
    afterEach(() => {
      Object.defineProperty(process, 'resourcesPath', {
        value: ORIG_RESOURCES_PATH,
        configurable: true,
      });
    });

    it('installCli writes a .cmd shim with ELECTRON_RUN_AS_NODE and quoted paths', () => {
      const res = installCli();
      expect(res.ok).toBe(true);

      const shimPath = expectedWinShim();
      expect(fs.existsSync(shimPath)).toBe(true);

      const content = fs.readFileSync(shimPath, 'utf8');
      expect(content).toContain('@echo off');
      expect(content).toContain('set ELECTRON_RUN_AS_NODE=1');
      expect(content).toContain('"C:\\Program Files\\Central Tracking\\Central Tracking.exe"');
      // CRLF line endings.
      expect(content.split('\r\n').length).toBeGreaterThan(2);
    });

    it('isCliInstalled reflects shim presence', () => {
      expect(isCliInstalled()).toBe(false);
      installCli();
      expect(isCliInstalled()).toBe(true);
    });

    it('appends bin dir to user PATH exactly once', () => {
      harness.userPathReturn = 'C:\\Windows;C:\\Windows\\System32';
      installCli();
      const setCalls = harness.psCalls.filter((c) =>
        c.some((a) => a.includes('SetEnvironmentVariable')),
      );
      expect(setCalls).toHaveLength(1);
      // PATH being written should include the new bin dir appended after existing entries.
      const expectedBin = expectedWinBinDir();
      expect(setCalls[0].some((a) => a.includes(expectedBin))).toBe(true);
    });

    it('skips PATH update when bin dir already present (case-insensitive)', () => {
      const binDir = expectedWinBinDir();
      harness.userPathReturn = `C:\\Windows;${binDir.toUpperCase()}`;
      installCli();
      const setCalls = harness.psCalls.filter((c) =>
        c.some((a) => a.includes('SetEnvironmentVariable')),
      );
      expect(setCalls).toHaveLength(0);
    });

    it('uninstallCli removes the shim', () => {
      installCli();
      uninstallCli();
      const shimPath = expectedWinShim();
      expect(fs.existsSync(shimPath)).toBe(false);
    });

    it('refreshCliWrapper regenerates the shim when execPath changes', () => {
      installCli();
      const shimPath = expectedWinShim();
      const before = fs.readFileSync(shimPath, 'utf8');

      setExecPath('D:\\NewPath\\Central Tracking.exe');
      refreshCliWrapper();
      const after = fs.readFileSync(shimPath, 'utf8');
      expect(after).not.toBe(before);
      expect(after).toContain('D:\\NewPath\\Central Tracking.exe');
    });

    it('refreshCliWrapper is a no-op when CLI not installed', () => {
      setExecPath('D:\\New.exe');
      refreshCliWrapper();
      const shimPath = expectedWinShim();
      expect(fs.existsSync(shimPath)).toBe(false);
    });
  });

  describe('POSIX (linux) — lifted darwin gate', () => {
    beforeEach(() => {
      setPlatform('linux');
      setExecPath('/usr/lib/central-tracking/electron');
    });

    it('installCli does not early-return on non-darwin', () => {
      // Before the gate was lifted, installCli on linux was a silent no-op
      // that left no artifacts. Now it actually attempts the symlink —
      // either succeeds at ~/.local/bin/ct, or fails for an environmental
      // reason (sandbox / read-only fs). Either way it should *try*.
      const res = installCli();
      const homeBin = path.join(os.homedir(), '.local', 'bin', 'ct');
      const prefBin = '/usr/local/bin/ct';
      if (res.ok) {
        expect(fs.existsSync(homeBin) || fs.existsSync(prefBin)).toBe(true);
        // Clean up so subsequent runs are deterministic.
        try { fs.unlinkSync(homeBin); } catch { /* ok */ }
        try { fs.unlinkSync(prefBin); } catch { /* ok, perms-protected */ }
      } else {
        expect(res.error).toBeTruthy();
      }
    });
  });
});
