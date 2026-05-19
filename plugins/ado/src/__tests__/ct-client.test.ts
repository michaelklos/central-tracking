import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CtClient, envVarNameFor } from '../ct-client';

describe('envVarNameFor', () => {
  it('upper-cases id and key and replaces hyphens', () => {
    expect(envVarNameFor('ado', 'pat')).toBe('CT_PLUGIN_ADO_PAT');
    expect(envVarNameFor('my-tool', 'api-key')).toBe('CT_PLUGIN_MY_TOOL_API_KEY');
  });
});

describe('CtClient.listPluginConfig env override', () => {
  let client: CtClient;
  let callSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CT_SERVER_URL = 'http://127.0.0.1:9999';
    process.env.CT_TOKEN = 'test';
    process.env.CT_PLUGIN_ID = 'ado';
    delete process.env.CT_PLUGIN_ADO_PAT;
    delete process.env.CT_PLUGIN_ADO_ORGANIZATION;

    client = new CtClient();
    // Stub the underlying HTTP call. Routes are exhaustively listed per test.
    callSpy = vi.spyOn(client as unknown as { call: (route: string, args: unknown[]) => Promise<unknown> }, 'call');
  });

  function mockResponses(map: Record<string, unknown>) {
    callSpy.mockImplementation(async (route: string) => map[route]);
  }

  it('returns DB value when env var is not set (secret key)', async () => {
    mockResponses({
      'plugins/listConfig': [
        { pluginId: 'ado', key: 'pat', value: 'from-db', secret: true, stored: 'encrypted' },
      ],
      'plugins/schema': [
        { key: 'pat', required: true, secret: true, status: 'encrypted', envVarName: 'CT_PLUGIN_ADO_PAT' },
      ],
    });
    const entries = await client.listPluginConfig();
    expect(entries.find((e) => e.key === 'pat')?.value).toBe('from-db');
  });

  it('env var overrides DB value for declared-secret keys', async () => {
    process.env.CT_PLUGIN_ADO_PAT = 'from-env';
    mockResponses({
      'plugins/listConfig': [
        { pluginId: 'ado', key: 'pat', value: 'from-db', secret: true, stored: 'encrypted' },
      ],
      'plugins/schema': [
        { key: 'pat', required: true, secret: true, status: 'encrypted', envVarName: 'CT_PLUGIN_ADO_PAT' },
      ],
    });
    const entries = await client.listPluginConfig();
    expect(entries.find((e) => e.key === 'pat')?.value).toBe('from-env');
  });

  it('env var does NOT override non-secret keys', async () => {
    process.env.CT_PLUGIN_ADO_ORGANIZATION = 'env-org';
    mockResponses({
      'plugins/listConfig': [
        { pluginId: 'ado', key: 'organization', value: 'db-org', secret: false, stored: 'plaintext' },
      ],
      'plugins/schema': [
        { key: 'organization', required: true, secret: false, status: 'set', envVarName: null },
      ],
    });
    const entries = await client.listPluginConfig();
    expect(entries.find((e) => e.key === 'organization')?.value).toBe('db-org');
  });

  it('synthesises an entry from env when the secret is not in the DB', async () => {
    process.env.CT_PLUGIN_ADO_PAT = 'env-only';
    mockResponses({
      'plugins/listConfig': [], // empty DB
      'plugins/schema': [
        { key: 'pat', required: true, secret: true, status: 'unset', envVarName: 'CT_PLUGIN_ADO_PAT' },
      ],
    });
    const entries = await client.listPluginConfig();
    const pat = entries.find((e) => e.key === 'pat');
    expect(pat).toBeDefined();
    expect(pat?.value).toBe('env-only');
    expect(pat?.secret).toBe(true);
  });

  it('passes reveal:true to listConfig so HTTP returns cleartext', async () => {
    mockResponses({ 'plugins/listConfig': [], 'plugins/schema': [] });
    await client.listPluginConfig();
    const listArgs = callSpy.mock.calls.find((c) => c[0] === 'plugins/listConfig')?.[1] as unknown[];
    expect(listArgs).toEqual(['ado', { reveal: true }]);
  });
});
