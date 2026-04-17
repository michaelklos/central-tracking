import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../../database/database';
import { startHttpServer, type HttpServerInstance } from '../httpServer';
import { signWebhookPayload } from '../webhooks';

/**
 * End-to-end plugin wiring test. Installs a fixture plugin, triggers a
 * mutating HTTP route, and asserts that the plugin's webhook endpoint
 * received a properly signed event payload.
 */

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

function startCapturingServer(): Promise<{ port: number; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        received,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function apiCall(port: number, token: string, endpoint: string, args: unknown[] = []) {
  const data = JSON.stringify({ args });
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/api/${endpoint}`,
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
          Host: `127.0.0.1:${port}`,
          Connection: 'close',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 2000, intervalMs = 20): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = check();
    if (result !== undefined && result !== null && (!Array.isArray(result) || result.length > 0)) {
      return result;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

describe('plugin webhook integration', () => {
  let db: Database;
  let server: HttpServerInstance;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-plugin-it-'));
    db = new Database(':memory:');
    server = await startHttpServer(db, tmpDir, () => null);
  });

  afterEach(async () => {
    await server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('installs a plugin and delivers a task.created webhook', async () => {
    const hook = await startCapturingServer();
    try {
      const install = await apiCall(server.port, server.token, 'plugins/install', [
        {
          id: 'fixture',
          name: 'Fixture',
          version: '1.0.0',
          events: ['task.created'],
          webhook: { url: `http://127.0.0.1:${hook.port}/events` },
        },
      ]);
      expect(install.status).toBe(200);

      // Drain the plugin.installed webhook from install itself (it goes nowhere
      // because 'fixture' is subscribed to task.created only).
      expect(hook.received).toHaveLength(0);

      const create = await apiCall(server.port, server.token, 'tasks/create', [{ title: 'Hello' }]);
      expect(create.status).toBe(200);

      const [received] = await waitFor(() => (hook.received.length > 0 ? hook.received : undefined));
      const payload = JSON.parse(received.body);
      expect(payload.event).toBe('task.created');
      expect(payload.route).toBe('tasks/create');
      expect(payload.data.title).toBe('Hello');
      expect(received.headers['x-ct-plugin-id']).toBe('fixture');
      expect(received.headers['x-ct-signature']).toBe(
        signWebhookPayload(server.token, received.body),
      );
    } finally {
      await hook.close();
    }
  });

  it('round-trips plugin config via the HTTP surface', async () => {
    await apiCall(server.port, server.token, 'plugins/install', [
      { id: 'cfg', name: 'Cfg', version: '1' },
    ]);
    await apiCall(server.port, server.token, 'plugins/setConfig', ['cfg', 'api-key', 'secret']);
    const got = await apiCall(server.port, server.token, 'plugins/getConfig', ['cfg', 'api-key']);
    expect(got.body).toEqual({ ok: true, data: 'secret' });
  });

  it('disabled plugin does not receive events', async () => {
    const hook = await startCapturingServer();
    try {
      await apiCall(server.port, server.token, 'plugins/install', [
        {
          id: 'off',
          name: 'Off',
          version: '1',
          events: ['*'],
          webhook: { url: `http://127.0.0.1:${hook.port}/events` },
        },
      ]);
      await apiCall(server.port, server.token, 'plugins/setEnabled', ['off', false]);

      // Clear anything that arrived before disable.
      hook.received.length = 0;

      await apiCall(server.port, server.token, 'tasks/create', [{ title: 'No Hook' }]);
      await new Promise((r) => setTimeout(r, 200));
      expect(hook.received).toHaveLength(0);
    } finally {
      await hook.close();
    }
  });
});
