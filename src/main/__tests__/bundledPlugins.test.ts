import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../database/database';
import { mockSafeStorage } from '../../test/mocks/safeStorage';

// vi.hoisted — vi.mock's factory runs before any non-hoisted module-level
// code, so shared state has to live inside hoisted() to be accessible from
// the factory closure.
const electronState = vi.hoisted(() => ({ packaged: true }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return electronState.packaged; },
  },
  safeStorage: mockSafeStorage,
}));

import { registerBundledPlugins, rewriteEntrypoint } from '../bundledPlugins';
import { getPlugin, setPluginEnabled } from '../ipc/pluginHandlers';

describe('bundledPlugins', () => {
  let db: Database;
  let fixtureRoot: string;
  let pluginsDir: string;
  const originalResourcesPath = process.resourcesPath;

  beforeEach(() => {
    db = new Database(':memory:');
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bp-'));
    pluginsDir = path.join(fixtureRoot, 'app.asar.unpacked', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: fixtureRoot,
      configurable: true,
    });
    electronState.packaged = true;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
  });

  function writePlugin(id: string, manifest: object): string {
    const dir = path.join(pluginsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const manifestPath = path.join(dir, 'plugin.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    return dir;
  }

  describe('registerBundledPlugins', () => {
    it('no-ops in dev mode (app.isPackaged=false)', () => {
      electronState.packaged = false;
      writePlugin('ado', { id: 'ado', name: 'ADO', version: '1.0.0' });
      registerBundledPlugins(db);
      expect(getPlugin(db, 'ado')).toBeNull();
    });

    it('registers a valid manifest as disabled + bundled', () => {
      writePlugin('ado', { id: 'ado', name: 'ADO', version: '1.0.0' });
      registerBundledPlugins(db);
      const p = getPlugin(db, 'ado');
      expect(p?.enabled).toBe(false);
      expect(p?.source).toBe('bundled');
    });

    it('isolates errors: bad manifest does not block siblings', () => {
      writePlugin('good', { id: 'good', name: 'Good', version: '1' });
      // Missing required `name` — should throw in validate but not abort
      // the loop.
      const badDir = path.join(pluginsDir, 'bad');
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(path.join(badDir, 'plugin.json'), JSON.stringify({ id: 'bad', version: '1' }));

      registerBundledPlugins(db);
      expect(getPlugin(db, 'good')).not.toBeNull();
      expect(getPlugin(db, 'bad')).toBeNull();
    });

    it('preserves enabled flag across version bump', () => {
      writePlugin('ado', { id: 'ado', name: 'ADO', version: '1.0.0' });
      registerBundledPlugins(db);
      setPluginEnabled(db, 'ado', true);

      // Bump version on disk and re-register.
      const manifestPath = path.join(pluginsDir, 'ado', 'plugin.json');
      fs.writeFileSync(manifestPath, JSON.stringify({ id: 'ado', name: 'ADO Renamed', version: '1.1.0' }));
      registerBundledPlugins(db);

      const after = getPlugin(db, 'ado');
      expect(after?.version).toBe('1.1.0');
      expect(after?.name).toBe('ADO Renamed');
      expect(after?.enabled).toBe(true);
    });

    it('skips directories without plugin.json', () => {
      const emptyDir = path.join(pluginsDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });
      registerBundledPlugins(db);
      // Nothing inserted.
      expect(getPlugin(db, 'empty')).toBeNull();
    });
  });

  describe('rewriteEntrypoint', () => {
    it('swaps `node` → process.execPath and injects ELECTRON_RUN_AS_NODE', () => {
      const rewritten = rewriteEntrypoint(
        { id: 'p', name: 'P', version: '1', entrypoint: 'node dist/index.js' },
        '/abs/manifest/dir',
      );
      expect(rewritten.entrypointArgv?.[0]).toBe(process.execPath);
      expect(rewritten.entrypointArgv?.[1]).toBe('/abs/manifest/dir/dist/index.js');
      expect(rewritten.env?.ELECTRON_RUN_AS_NODE).toBe('1');
    });

    it('leaves non-node interpreters alone (no env injection)', () => {
      const rewritten = rewriteEntrypoint(
        { id: 'p', name: 'P', version: '1', entrypoint: 'python3 script.py' },
        '/abs/manifest/dir',
      );
      expect(rewritten.entrypointArgv?.[0]).toBe('python3');
      expect(rewritten.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });

    it('preserves flags and absolute paths', () => {
      const rewritten = rewriteEntrypoint(
        {
          id: 'p', name: 'P', version: '1',
          entrypoint: 'node --enable-source-maps /already/absolute.js',
        },
        '/manifest/dir',
      );
      expect(rewritten.entrypointArgv).toEqual([
        process.execPath,
        '--enable-source-maps',
        '/already/absolute.js',
      ]);
    });

    it('returns manifest unchanged when no entrypoint set', () => {
      const manifest = { id: 'p', name: 'P', version: '1' };
      const rewritten = rewriteEntrypoint(manifest, '/x');
      expect(rewritten).toBe(manifest);
    });

    it('preserves user-set env values, only adding ELECTRON_RUN_AS_NODE', () => {
      const rewritten = rewriteEntrypoint(
        {
          id: 'p', name: 'P', version: '1',
          entrypoint: 'node dist/index.js',
          env: { CUSTOM: 'value' },
        },
        '/abs',
      );
      expect(rewritten.env?.CUSTOM).toBe('value');
      expect(rewritten.env?.ELECTRON_RUN_AS_NODE).toBe('1');
    });
  });
});
