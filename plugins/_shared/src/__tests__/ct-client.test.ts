import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CtClient, envVarNameFor } from '../ct-client';

describe('envVarNameFor', () => {
  it('upper-cases id and key and replaces hyphens', () => {
    expect(envVarNameFor('ado', 'pat')).toBe('CT_PLUGIN_ADO_PAT');
    expect(envVarNameFor('my-tool', 'api-key')).toBe('CT_PLUGIN_MY_TOOL_API_KEY');
  });
});

describe('CtClient constructor', () => {
  beforeEach(() => {
    process.env.CT_SERVER_URL = 'http://127.0.0.1:9999';
    process.env.CT_TOKEN = 'test';
  });

  it('requires a pluginId', () => {
    expect(() => new CtClient('')).toThrow(/pluginId is required/);
  });

  it('records the pluginId for downstream calls', () => {
    const c = new CtClient('jira');
    expect(c.pluginId).toBe('jira');
  });

  it('rejects missing CT_SERVER_URL', () => {
    delete process.env.CT_SERVER_URL;
    expect(() => new CtClient('ado')).toThrow(/CT_SERVER_URL/);
  });

  it('rejects missing CT_TOKEN', () => {
    delete process.env.CT_TOKEN;
    expect(() => new CtClient('ado')).toThrow(/CT_TOKEN/);
  });
});

describe('CtClient.listPluginConfig env override', () => {
  let client: CtClient;
  let callSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CT_SERVER_URL = 'http://127.0.0.1:9999';
    process.env.CT_TOKEN = 'test';
    delete process.env.CT_PLUGIN_JIRA_PAT;
    delete process.env.CT_PLUGIN_JIRA_ORGANIZATION;

    // Use a non-ADO pluginId so this test exercises the shared client with a
    // different plugin and proves the env-shadowing is parameterised on
    // pluginId, not hardcoded.
    client = new CtClient('jira');
    callSpy = vi.spyOn(client as unknown as { call: (route: string, args: unknown[]) => Promise<unknown> }, 'call');
  });

  function mockResponses(map: Record<string, unknown>) {
    callSpy.mockImplementation(async (route: string) => map[route]);
  }

  it('returns DB value when env var is not set (secret key)', async () => {
    mockResponses({
      'plugins/listConfig': [
        { pluginId: 'jira', key: 'pat', value: 'from-db', secret: true, stored: 'encrypted' },
      ],
      'plugins/schema': [
        { key: 'pat', required: true, secret: true, status: 'encrypted', envVarName: 'CT_PLUGIN_JIRA_PAT' },
      ],
    });
    const entries = await client.listPluginConfig();
    expect(entries.find((e) => e.key === 'pat')?.value).toBe('from-db');
  });

  it('env var overrides DB value for declared-secret keys', async () => {
    process.env.CT_PLUGIN_JIRA_PAT = 'from-env';
    mockResponses({
      'plugins/listConfig': [
        { pluginId: 'jira', key: 'pat', value: 'from-db', secret: true, stored: 'encrypted' },
      ],
      'plugins/schema': [
        { key: 'pat', required: true, secret: true, status: 'encrypted', envVarName: 'CT_PLUGIN_JIRA_PAT' },
      ],
    });
    const entries = await client.listPluginConfig();
    expect(entries.find((e) => e.key === 'pat')?.value).toBe('from-env');
  });

  it('env var does NOT override non-secret keys', async () => {
    process.env.CT_PLUGIN_JIRA_ORGANIZATION = 'env-org';
    mockResponses({
      'plugins/listConfig': [
        { pluginId: 'jira', key: 'organization', value: 'db-org', secret: false, stored: 'plaintext' },
      ],
      'plugins/schema': [
        { key: 'organization', required: true, secret: false, status: 'set', envVarName: null },
      ],
    });
    const entries = await client.listPluginConfig();
    expect(entries.find((e) => e.key === 'organization')?.value).toBe('db-org');
  });

  it('synthesises an entry from env when the secret is not in the DB', async () => {
    process.env.CT_PLUGIN_JIRA_PAT = 'env-only';
    mockResponses({
      'plugins/listConfig': [],
      'plugins/schema': [
        { key: 'pat', required: true, secret: true, status: 'unset', envVarName: 'CT_PLUGIN_JIRA_PAT' },
      ],
    });
    const entries = await client.listPluginConfig();
    const pat = entries.find((e) => e.key === 'pat');
    expect(pat).toBeDefined();
    expect(pat?.value).toBe('env-only');
    expect(pat?.secret).toBe(true);
  });

  it('passes the constructor pluginId (not a default) to listConfig', async () => {
    mockResponses({ 'plugins/listConfig': [], 'plugins/schema': [] });
    await client.listPluginConfig();
    const listArgs = callSpy.mock.calls.find((c: unknown[]) => c[0] === 'plugins/listConfig')?.[1] as unknown[];
    expect(listArgs).toEqual(['jira', { reveal: true }]);
  });
});
