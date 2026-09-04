import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../../database/database';
import { startHttpServer, type HttpServerInstance } from '../httpServer';

function makeRequest(
  port: number,
  token: string,
  endpoint: string,
  args: unknown[] = [],
  overrides: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ args });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/api/${endpoint}`,
        method: overrides.method ?? 'POST',
        agent: false, // Disable keep-alive to prevent connection reuse between tests
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
          Host: `127.0.0.1:${port}`,
          Connection: 'close',
          ...overrides.headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(body) });
          } catch {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('HTTP Server', () => {
  let db: Database;
  let server: HttpServerInstance;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-server-test-'));
    db = new Database(':memory:');
    server = await startHttpServer(db, tmpDir, () => null);
  });

  afterEach(async () => {
    await server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('server lifecycle', () => {
    it('writes server file on start', () => {
      const filePath = path.join(tmpDir, 'ct-server.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const info = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(info.port).toBe(server.port);
      expect(info.token).toBe(server.token);
      expect(info.pid).toBe(process.pid);
    });

    it('removes server file on close', async () => {
      const filePath = path.join(tmpDir, 'ct-server.json');
      await server.close();
      expect(fs.existsSync(filePath)).toBe(false);
      // Recreate for afterEach
      server = await startHttpServer(db, tmpDir, () => null);
    });
  });

  /**
   * `CtClient.setExternalTaskState` sends positional args, so omitting
   * `pushedStatus` puts `undefined` at the end of the array — and
   * JSON.stringify turns a trailing `undefined` into `null`. The handler must
   * treat that as "no status was pushed" (its documented back-compat path),
   * not as "the pushed status was null".
   */
  describe('setExternalState back-compat over HTTP', () => {
    const createDirtyTask = async () => {
      const { body } = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'Mirror' },
      ]);
      const id = (body.data as { id: string }).id;
      // Mirror-task columns are set directly: creating a real plugin task
      // needs a plugins row, and none of that matters to the flag's logic.
      db.instance
        .prepare("UPDATE tasks SET source = 'plugin', state_dirty = 1 WHERE id = ?")
        .run(id);
      return id;
    };

    const stateDirty = (id: string) =>
      (db.instance.prepare('SELECT state_dirty FROM tasks WHERE id = ?').get(id) as
        { state_dirty: number }).state_dirty;

    it('clears state_dirty when pushedStatus is omitted', async () => {
      const id = await createDirtyTask();

      // Exactly what CtClient sends when the caller omits the argument.
      const { body } = await makeRequest(server.port, server.token, 'tasks/setExternalState', [
        id,
        'Active',
        undefined,
      ]);

      expect(body.ok).toBe(true);
      expect((body.data as { stillDirty: boolean }).stillDirty).toBe(false);
      expect(stateDirty(id)).toBe(0);
    });

    it('still keeps state_dirty when the status moved under an in-flight push', async () => {
      const id = await createDirtyTask();
      db.instance.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(id);

      const { body } = await makeRequest(server.port, server.token, 'tasks/setExternalState', [
        id,
        'Active',
        'in-progress',
      ]);

      expect((body.data as { stillDirty: boolean }).stillDirty).toBe(true);
      expect(stateDirty(id)).toBe(1);
    });

    it('clears state_dirty when the pushed status is still current', async () => {
      const id = await createDirtyTask();
      db.instance.prepare("UPDATE tasks SET status = 'in-progress' WHERE id = ?").run(id);

      const { body } = await makeRequest(server.port, server.token, 'tasks/setExternalState', [
        id,
        'Active',
        'in-progress',
      ]);

      expect((body.data as { stillDirty: boolean }).stillDirty).toBe(false);
      expect(stateDirty(id)).toBe(0);
    });
  });

  describe('authentication', () => {
    it('rejects requests without auth token', async () => {
      const { status, body } = await makeRequest(server.port, '', 'tasks/getAll', [], {
        headers: { Authorization: '' },
      });
      expect(status).toBe(401);
      expect(body.ok).toBe(false);
    });

    it('rejects requests with wrong token', async () => {
      const { status, body } = await makeRequest(server.port, 'wrong-token', 'tasks/getAll');
      expect(status).toBe(401);
      expect(body.ok).toBe(false);
    });

    it('accepts requests with correct token', async () => {
      const { status, body } = await makeRequest(server.port, server.token, 'tasks/getAll');
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
    });
  });

  describe('host validation', () => {
    it('rejects requests with invalid host header', async () => {
      const { status, body } = await makeRequest(server.port, server.token, 'tasks/getAll', [], {
        headers: { Host: 'evil.com:19532' },
      });
      expect(status).toBe(403);
      expect(body.ok).toBe(false);
    });
  });

  describe('routing', () => {
    it('returns 404 for unknown endpoints', async () => {
      const { status, body } = await makeRequest(server.port, server.token, 'unknown/endpoint');
      expect(status).toBe(404);
      expect(body.ok).toBe(false);
    });

    it('returns 404 for non-POST methods', async () => {
      const { status } = await makeRequest(server.port, server.token, 'tasks/getAll', [], {
        method: 'GET',
      });
      expect(status).toBe(404);
    });
  });

  describe('task operations', () => {
    it('creates and retrieves a task', async () => {
      const createRes = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'Test Task' },
      ]);
      expect(createRes.status).toBe(200);
      expect(createRes.body.ok).toBe(true);
      const task = (createRes.body as { ok: boolean; data: { id: string; title: string } }).data;
      expect(task.title).toBe('Test Task');
      expect(task.id).toBeDefined();

      const getRes = await makeRequest(server.port, server.token, 'tasks/getById', [task.id]);
      expect(getRes.status).toBe(200);
      expect((getRes.body as { data: { title: string } }).data.title).toBe('Test Task');
    });

    it('lists active tasks', async () => {
      await makeRequest(server.port, server.token, 'tasks/create', [{ title: 'Task 1' }]);
      await makeRequest(server.port, server.token, 'tasks/create', [{ title: 'Task 2' }]);

      const res = await makeRequest(server.port, server.token, 'tasks/getActive');
      expect(res.status).toBe(200);
      const data = (res.body as { data: { items: unknown[]; total: number } }).data;
      expect(data.items).toHaveLength(2);
      expect(data.total).toBe(2);
    });
  });

  describe('time entry operations', () => {
    it('creates a time entry and retrieves active entry', async () => {
      const taskRes = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'Timed Task' },
      ]);
      const taskId = (taskRes.body as { data: { id: string } }).data.id;

      // Start timer
      const createRes = await makeRequest(server.port, server.token, 'timeEntries/create', [
        { taskId },
      ]);
      expect(createRes.status).toBe(200);

      // Check active
      const activeRes = await makeRequest(server.port, server.token, 'timeEntries/getActive');
      expect(activeRes.status).toBe(200);
      const active = (activeRes.body as { data: { taskId: string } | null }).data;
      expect(active).not.toBeNull();
      expect(active!.taskId).toBe(taskId);

      // Stop timer
      const stopRes = await makeRequest(server.port, server.token, 'timeEntries/stopActive');
      expect(stopRes.status).toBe(200);

      // No active entry
      const afterStop = await makeRequest(server.port, server.token, 'timeEntries/getActive');
      expect((afterStop.body as { data: null }).data).toBeNull();
    });
  });

  describe('report operations', () => {
    it('generates CSV content', async () => {
      const res = await makeRequest(server.port, server.token, 'reports/generateCsv', [
        '2026-01-01',
        '2026-12-31',
      ]);
      expect(res.status).toBe(200);
      const csv = (res.body as { data: string }).data;
      expect(csv).toContain('Date,Task,Start,End,Duration,Note');
    });
  });

  describe('import operations', () => {
    it('parses import content', async () => {
      const markdown = `# 2026-04-11

- 09:00 1h Test Task`;

      const res = await makeRequest(server.port, server.token, 'import/parseContent', [markdown]);
      expect(res.status).toBe(200);
      expect((res.body as { data: { items: unknown[] } }).data.items).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('returns error for invalid JSON body', async () => {
      const { status, body } = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
        const data = 'not json';
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: server.port,
            path: '/api/tasks/getAll',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
              Authorization: `Bearer ${server.token}`,
              Host: `127.0.0.1:${server.port}`,
            },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
          },
        );
        req.on('error', reject);
        req.write(data);
        req.end();
      });
      expect(status).toBe(500);
      expect(body.ok).toBe(false);
    });
  });
});
