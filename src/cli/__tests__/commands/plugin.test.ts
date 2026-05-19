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
    expect(calls).toEqual([
      { endpoint: 'plugins/getConfig', args: ['ado', 'api-key', { reveal: false }] },
    ]);
    expect(stdout.trim()).toBe('secret');
  });

  it('get --reveal forwards reveal:true', async () => {
    const { calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'get', 'ado', 'api-key', '--reveal'],
      { responses: { 'plugins/getConfig': 'secret' } },
    );
    expect(calls).toEqual([
      { endpoint: 'plugins/getConfig', args: ['ado', 'api-key', { reveal: true }] },
    ]);
  });

  it('set posts plugins/setConfig with opts', async () => {
    const { calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'set', 'ado', 'api-key', 's3cr3t'],
      { responses: { 'plugins/setConfig': { stored: 'plaintext' } } },
    );
    expect(calls).toEqual([
      { endpoint: 'plugins/setConfig', args: ['ado', 'api-key', 's3cr3t', { secret: false, allowPlaintext: false }] },
    ]);
  });

  it('set --secret forwards secret:true', async () => {
    const { stdout, calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'set', 'ado', 'api-key', 's3cr3t', '--secret'],
      { responses: { 'plugins/setConfig': { stored: 'encrypted' } } },
    );
    expect(calls).toEqual([
      { endpoint: 'plugins/setConfig', args: ['ado', 'api-key', 's3cr3t', { secret: true, allowPlaintext: false }] },
    ]);
    expect(stdout).toContain('(encrypted)');
  });

  it('set echoes the warning when server returns one', async () => {
    const { stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'set', 'ado', 'api-key', 's3cr3t', '--secret', '--allow-plaintext'],
      { responses: { 'plugins/setConfig': { stored: 'plaintext', warning: 'fallback' } } },
    );
    expect(stdout).toContain('fallback');
  });

  it('list empty → "No config set."', async () => {
    const { stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'list', 'ado'],
      { responses: { 'plugins/listConfig': [] } },
    );
    expect(stdout).toContain('No config set');
  });

  it('list renders key=value with secret tag for encrypted entries', async () => {
    const { stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'list', 'ado'],
      {
        responses: {
          'plugins/listConfig': [
            { key: 'api-key', value: '[encrypted]', secret: true, stored: 'encrypted' },
            { key: 'host', value: 'example.com', secret: false, stored: 'plaintext' },
          ],
        },
      },
    );
    expect(stdout).toContain('api-key = [encrypted] [encrypted]');
    expect(stdout).toContain('host = example.com');
  });

  it('list --reveal forwards reveal:true', async () => {
    const { calls } = await runCli(
      registerPluginCommands,
      ['plugin', 'config', 'list', 'ado', '--reveal'],
      { responses: { 'plugins/listConfig': [] } },
    );
    expect(calls).toEqual([
      { endpoint: 'plugins/listConfig', args: ['ado', { reveal: true }] },
    ]);
  });

  it('schema renders required/secret/status/env columns', async () => {
    const { stdout } = await runCli(
      registerPluginCommands,
      ['plugin', 'schema', 'ado'],
      {
        responses: {
          'plugins/get': { id: 'ado', name: 'Azure DevOps Sync', version: '0.1.0', enabled: true, manifest: { id: 'ado', name: 'Azure DevOps Sync', version: '0.1.0' }, installedAt: '' },
          'plugins/schema': [
            { key: 'pat',  required: true,  secret: true,  status: 'encrypted', envVarName: 'CT_PLUGIN_ADO_PAT', description: 'Token' },
            { key: 'host', required: true,  secret: false, status: 'set',       envVarName: null, description: 'Host' },
          ],
        },
      },
    );
    expect(stdout).toContain('KEY');
    expect(stdout).toContain('REQUIRED');
    expect(stdout).toContain('SECRET');
    expect(stdout).toContain('STATUS');
    expect(stdout).toContain('CT_PLUGIN_ADO_PAT');
    expect(stdout).toContain('encrypted');
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

describe('ct plugin run required-key gating', () => {
  it('fails fast when a required config key is unset and no env override is present', async () => {
    delete process.env.CT_PLUGIN_ADO_PAT;
    const { stderr, exitCode } = await runCli(
      registerPluginCommands,
      ['plugin', 'run', 'ado'],
      {
        responses: {
          'plugins/get': samplePlugin,
          'plugins/schema': [
            { key: 'pat',          required: true,  secret: true,  status: 'unset', envVarName: 'CT_PLUGIN_ADO_PAT' },
            { key: 'organization', required: true,  secret: false, status: 'set',   envVarName: null },
          ],
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Missing required config');
    expect(stderr).toContain('pat');
  });

  it('passes the gate when env var satisfies the requirement', async () => {
    process.env.CT_PLUGIN_ADO_PAT = 'from-env';
    // Don't actually spawn — only test the gate. Use an entrypoint that exits 0.
    const fakePlugin = {
      ...samplePlugin,
      manifest: { ...samplePlugin.manifest, entrypoint: 'node -e "process.exit(0)"' },
    };
    const { stderr, exitCode } = await runCli(
      registerPluginCommands,
      ['plugin', 'run', 'ado'],
      {
        responses: {
          'plugins/get': fakePlugin,
          'plugins/schema': [
            { key: 'pat', required: true, secret: true, status: 'unset', envVarName: 'CT_PLUGIN_ADO_PAT' },
          ],
        },
      },
    );
    delete process.env.CT_PLUGIN_ADO_PAT;
    expect(stderr).not.toContain('Missing required config');
    // The harness only records exitCode when the CLI calls process.exit;
    // a clean spawn-and-await path leaves it null, which is fine here.
    expect([0, null]).toContain(exitCode);
  });
});
