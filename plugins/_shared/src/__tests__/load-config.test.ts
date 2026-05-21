import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CtClient } from '../ct-client';
import { loadConfig } from '../load-config';

describe('loadConfig', () => {
  let client: CtClient;
  let listSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CT_SERVER_URL = 'http://127.0.0.1:9999';
    process.env.CT_TOKEN = 'test';
    client = new CtClient('demo');
    listSpy = vi.spyOn(client, 'listPluginConfig');
  });

  it('returns the parsed shape when all required keys are present', async () => {
    listSpy.mockResolvedValue([
      { pluginId: 'demo', key: 'api-key', value: 'abc', secret: true, stored: 'encrypted' },
      { pluginId: 'demo', key: 'host',    value: 'example.com', secret: false, stored: 'plaintext' },
    ]);
    const cfg = await loadConfig(client, ['api-key', 'host'], (map) => ({
      apiKey: map['api-key'],
      host: map.host,
    }));
    expect(cfg).toEqual({ apiKey: 'abc', host: 'example.com' });
  });

  it('throws with a remediation hint when required keys are missing', async () => {
    listSpy.mockResolvedValue([
      { pluginId: 'demo', key: 'host', value: 'example.com', secret: false, stored: 'plaintext' },
    ]);
    await expect(
      loadConfig(client, ['api-key', 'host'], (map) => map),
    ).rejects.toThrow(/Missing required demo config keys: api-key/);
    await expect(
      loadConfig(client, ['api-key', 'host'], (map) => map),
    ).rejects.toThrow(/ct plugin config set demo/);
  });

  it('reports every missing key in one error', async () => {
    listSpy.mockResolvedValue([]);
    await expect(
      loadConfig(client, ['a', 'b', 'c'], (map) => map),
    ).rejects.toThrow(/a, b, c/);
  });
});
