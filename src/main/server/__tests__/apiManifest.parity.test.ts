import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { apiManifest, buildRouteMap } from '../apiManifest';

/**
 * The manifest is the single source of truth for CLI-reachable operations.
 * These tests make sure it stays in sync with:
 *   - the IPC handler registrations (every CLI-exposed IPC channel has a route)
 *   - the typed CLI client (every route has a typed method, and vice versa)
 *
 * Routes that intentionally have no IPC binding (e.g. `reports/generateCsv`
 * whose IPC counterpart wraps it in a save dialog) carry `ipcChannel: null`.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), 'utf-8');
}

function extractIpcChannels(fileContents: string): string[] {
  const matches = fileContents.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g);
  return [...matches].map((m) => m[1]);
}

function collectRegisteredIpcChannels(): string[] {
  const ipcFiles = [
    'src/main/ipc/taskHandlers.ts',
    'src/main/ipc/timeEntryHandlers.ts',
    'src/main/ipc/commentHandlers.ts',
    'src/main/ipc/categoryHandlers.ts',
    'src/main/ipc/reportHandlers.ts',
    'src/main/ipc/importHandlers.ts',
  ];
  return ipcFiles.flatMap((f) => extractIpcChannels(readRepoFile(f)));
}

function extractCliClientRoutes(): string[] {
  // Parse the api.ts source for request<T>('route/path', ...) calls.
  const apiSource = readRepoFile('src/cli/api.ts');
  // Matches `request<...>('route', ...)` and `request('route', ...)`.
  // `[^(]*` inside the generic tolerates nested types like PaginatedResponse<Task>.
  const matches = apiSource.matchAll(/request\s*(?:<[^(]*>)?\s*\(\s*['"]([^'"]+)['"]/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

describe('apiManifest', () => {
  it('has no duplicate routes', () => {
    const routes = apiManifest.map((e) => e.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('buildRouteMap includes every manifest entry', () => {
    const map = buildRouteMap();
    for (const entry of apiManifest) {
      expect(map[entry.route]).toBe(entry);
    }
  });

  it('every mutating route carries an event name (for plugin webhooks)', () => {
    for (const entry of apiManifest) {
      if (entry.mutates) {
        expect(entry.event, `route ${entry.route} is mutating but has no event`).toBeTruthy();
      }
    }
  });

  it('every CLI-facing IPC channel (domain:operation) has a matching route', () => {
    // UI-only IPC channels.
    //   `reports:exportCsv`     — wraps the pure CSV generator in a save dialog.
    //   `import:selectAndParse` — wraps the pure parser in a file dialog.
    //   `tasks:resetApp`        — destructive total-wipe; requires the in-UI
    //                             confirm flow, no CLI shortcut by design.
    const UI_ONLY_CHANNELS = new Set([
      'reports:exportCsv',
      'import:selectAndParse',
      'tasks:resetApp',
    ]);

    const registered = collectRegisteredIpcChannels().filter((c) => !UI_ONLY_CHANNELS.has(c));
    const routeIpcChannels = new Set(
      apiManifest.map((e) => e.ipcChannel).filter((c): c is string => c !== null),
    );

    const missing = registered.filter((c) => !routeIpcChannels.has(c));
    expect(missing, 'IPC channels not bound to a manifest route').toEqual([]);
  });

  it('every manifest ipcChannel is actually registered (no stale entries)', () => {
    const registered = new Set(collectRegisteredIpcChannels());
    const stale = apiManifest
      .map((e) => e.ipcChannel)
      .filter((c): c is string => c !== null)
      .filter((c) => !registered.has(c));
    expect(stale, 'manifest routes referencing IPC channels that are no longer registered').toEqual([]);
  });

  it('every manifest route has a typed method on the CLI client', () => {
    const clientRoutes = new Set(extractCliClientRoutes());
    const missing = apiManifest.map((e) => e.route).filter((r) => !clientRoutes.has(r));
    expect(missing, 'manifest routes with no CLI client method').toEqual([]);
  });

  it('every CLI client method calls a route that exists in the manifest', () => {
    const manifestRoutes = new Set(apiManifest.map((e) => e.route));
    const stale = extractCliClientRoutes().filter((r) => !manifestRoutes.has(r));
    expect(stale, 'CLI client methods calling unknown routes').toEqual([]);
  });
});
