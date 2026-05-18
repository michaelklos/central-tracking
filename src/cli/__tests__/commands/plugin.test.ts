import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli } from './harness';
import { registerPluginCommands } from '../../commands/plugin';

let tmpDir: string;
let manifestFile: string;

const samplePlugin = {
  id: 'ado',
  name: 'ADO Sync',
  version: '0.1.0',
  enabled: true,
  manifest: {
    id: 'ado',
    name: 'ADO Sync',
    version: '0.1.0',
    entrypoint: 'node sync.js',
    events: ['task.created'],
    webhook: { url: 'http://127.0.0.1:9901/ct-events' },
  },
  installedAt: '2026-04-17T10:00:00.000Z',
};

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-plugin-test-'));
  manifestFile = path.join(tmpDir, 'plugin.json');
  fs.writeFileSync(manifestFile, JSON.stringify(samplePlugin.manifest), 'utf-8');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ct plugin install', () => {
  it('reads manifest + posts plugins/install (entrypoint rewritten to absolute)', async () => {
    const { calls, stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'install', manifestFile],
      { responses: { 'plugins/install': samplePlugin } },
    );
    const expectedManifest = {
      ...samplePlugin.manifest,
      entrypoint: `node ${path.resolve(tmpDir, 'sync.js')}`,
    };
    expect(calls).toEqual([{ endpoint: 'plugins/install', args: [expectedManifest] }]);
    expect(stdout).toContain('Installed plugin ado');
  });

  it('exits 1 when manifest file missing', async () => {
    const { exitCode, stderr } = await runCli(
      registerPluginCommands,
      ['plugin', 'install', '/does/not/exist.json'],
      { responses: {} },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Plugin manifest not found');
  });

  it('exits 1 when manifest file is invalid JSON', async () => {
    const bad = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(bad, '{not json', 'utf-8');
    const { exitCode, stderr } = await runCli(
      registerPluginCommands,
      ['plugin', 'install', bad],
      { responses: {} },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid JSON');
  });
});

describe('ct plugin list', () => {
  it('human output shows enabled/disabled + webhook', async () => {
    const { stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'list'],
      { responses: { 'plugins/list': [samplePlugin, { ...samplePlugin, id: 'other', enabled: false }] } },
    );
    expect(stdout).toContain('enabled ');
    expect(stdout).toContain('disabled');
    expect(stdout).toContain('http://127.0.0.1:9901/ct-events');
  });

  it('prints "No plugins installed." when empty', async () => {
    const { stdout } = await runCli(registerPluginCommands, ['plugin', 'list'], {
      responses: { 'plugins/list': [] },
    });
    expect(stdout).toContain('No plugins installed');
  });
});

describe('ct plugin enable / disable / uninstall', () => {
  it('enable posts plugins/setEnabled true', async () => {
    const { calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'enable', 'ado'],
      { responses: { 'plugins/setEnabled': samplePlugin } },
    );
    expect(calls).toEqual([{ endpoint: 'plugins/setEnabled', args: ['ado', true] }]);
  });

  it('disable posts plugins/setEnabled false', async () => {
    const { calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'disable', 'ado'],
      { responses: { 'plugins/setEnabled': samplePlugin } },
    );
    expect(calls).toEqual([{ endpoint: 'plugins/setEnabled', args: ['ado', false] }]);
  });

  it('uninstall posts plugins/uninstall', async () => {
    const { calls, stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'uninstall', 'ado'],
      { responses: { 'plugins/uninstall': undefined } },
    );
    expect(calls).toEqual([{ endpoint: 'plugins/uninstall', args: ['ado'] }]);
    expect(stdout).toContain('Uninstalled plugin ado');
  });
});

describe('ct plugin config', () => {
  it('get prints value', async () => {
    const { stdout, calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'get', 'ado', 'api-key'],
      { responses: { 'plugins/getConfig': 'secret' } },
    );
    expect(calls).toEqual([{ endpoint: 'plugins/getConfig', args: ['ado', 'api-key'] }]);
    expect(stdout.trim()).toBe('secret');
  });

  it('set posts plugins/setConfig', async () => {
    const { calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'set', 'ado', 'api-key', 's3cr3t'],
      { responses: { 'plugins/setConfig': undefined } },
    );
    expect(calls).toEqual([
      { endpoint: 'plugins/setConfig', args: ['ado', 'api-key', 's3cr3t'] },
    ]);
  });

  it('list empty → "No config set."', async () => {
    const { stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'list', 'ado'],
      { responses: { 'plugins/listConfig': [] } },
    );
    expect(stdout).toContain('No config set');
  });

  it('list renders key=value', async () => {
    const { stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'list', 'ado'],
      { responses: { 'plugins/listConfig': [{ key: 'api-key', value: 's3cr3t' }] } },
    );
    expect(stdout).toContain('api-key = s3cr3t');
  });

  it('delete posts plugins/deleteConfig', async () => {
    const { calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'delete', 'ado', 'api-key'],
      { responses: { 'plugins/deleteConfig': undefined } },
    );
    expect(calls).toEqual([
      { endpoint: 'plugins/deleteConfig', args: ['ado', 'api-key'] },
    ]);
  });
});
