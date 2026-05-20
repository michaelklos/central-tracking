import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { Database } from './database/database';
import type { PluginManifest } from '../shared/types';
import { registerBundledPlugin, validatePluginManifest } from './ipc/pluginHandlers';
import { log } from './logger';

// Where bundled plugins live in a packaged build. electron-builder
// asarUnpacks plugins/<id>/dist, plugins/<id>/plugin.json and
// plugins/<id>/node_modules so the plugin can spawn from a real on-disk
// path. Returns null in dev (registrar short-circuits — devs use
// `ct plugin install` instead).
function bundledPluginsDir(): string | null {
  if (!app.isPackaged) return null;
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'plugins');
}

/**
 * Rewrite a manifest entrypoint so it runs inside the packaged app:
 *   - First token `node` → `process.execPath` (Electron binary).
 *     Injects `ELECTRON_RUN_AS_NODE=1` into manifest.env so the binary
 *     behaves as a Node host. Other interpreters (python, ./bin/foo) are
 *     left alone — the user is responsible for installing them.
 *   - Remaining tokens that look like relative file paths are resolved
 *     against the manifest's directory.
 */
export function rewriteEntrypoint(manifest: PluginManifest, manifestDir: string): PluginManifest {
  if (!manifest.entrypoint && !manifest.entrypointArgv) return manifest;
  const sourceTokens = manifest.entrypointArgv
    ? [...manifest.entrypointArgv]
    : manifest.entrypoint!.split(/\s+/).filter(Boolean);
  if (sourceTokens.length === 0) return manifest;

  let envAdditions: Record<string, string> = {};
  if (sourceTokens[0] === 'node') {
    sourceTokens[0] = process.execPath;
    envAdditions = { ELECTRON_RUN_AS_NODE: '1' };
  }

  const argv = [
    sourceTokens[0],
    ...sourceTokens.slice(1).map((t) => {
      if (t.startsWith('-')) return t;
      if (path.isAbsolute(t)) return t;
      const looksLikePath =
        t.includes('/') || t.includes('\\') || /\.(js|cjs|mjs)$/.test(t);
      return looksLikePath ? path.resolve(manifestDir, t) : t;
    }),
  ];

  // Emit `entrypointArgv` so spawn at runtime gets the argv verbatim — no
  // shell-quoting required. process.execPath on macOS contains spaces
  // ("/Applications/Central Tracking.app/Contents/MacOS/Central Tracking")
  // and would otherwise mangle on a /\s+/ split.
  return {
    ...manifest,
    entrypointArgv: argv,
    env: { ...envAdditions, ...(manifest.env ?? {}) },
  };
}

/**
 * Scan `<resources>/app.asar.unpacked/plugins/*` and auto-register each
 * `plugin.json` as a bundled plugin (enabled=0, source='bundled').
 * Idempotent — same-version manifests no-op; version bumps trigger UPDATE
 * without touching the user's enabled flag.
 *
 * Per-plugin errors are logged and isolated so one bad manifest doesn't
 * stop the rest.
 */
export function registerBundledPlugins(db: Database): void {
  const dir = bundledPluginsDir();
  if (!dir || !fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const validated = validatePluginManifest(raw);
      const prepared = rewriteEntrypoint(validated, path.dirname(manifestPath));
      registerBundledPlugin(db, prepared);
      log.info(`Bundled plugin registered: ${prepared.id} v${prepared.version}`);
    } catch (err) {
      log.warn(`Failed to register bundled plugin at ${manifestPath}:`, String(err));
    }
  }
}
