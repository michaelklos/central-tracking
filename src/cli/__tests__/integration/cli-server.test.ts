import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../../../main/database/database';
import { startHttpServer, type HttpServerInstance } from '../../../main/server/httpServer';

/**
 * Integration tests: CLI client → HTTP server → database
 *
 * These tests simulate what the CLI does: make HTTP requests to the server
 * and verify the results. The server runs against an in-memory SQLite database.
 */

function makeRequest(
  port: number,
  token: string,
  endpoint: string,
  args: unknown[] = [],
): Promise<{ status: number; body: { ok: boolean; data?: unknown; error?: { code: string; message: string } } }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ args });
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

describe('CLI → Server Integration', () => {
  let db: Database;
  let server: HttpServerInstance;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-integration-'));
    db = new Database(':memory:');
    server = await startHttpServer(db, tmpDir, () => null);
  });

  afterEach(async () => {
    await server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('task workflow', () => {
    it('creates, lists, updates, and deletes a task', async () => {
      // Create
      const createRes = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'CLI Test Task', description: 'Created via integration test' },
      ]);
      expect(createRes.body.ok).toBe(true);
      const task = createRes.body.data as { id: string; title: string; status: string };
      expect(task.title).toBe('CLI Test Task');
      expect(task.status).toBe('todo');

      // List active
      const listRes = await makeRequest(server.port, server.token, 'tasks/getActive');
      expect(listRes.body.ok).toBe(true);
      const list = listRes.body.data as { items: { id: string }[]; total: number };
      expect(list.total).toBe(1);
      expect(list.items[0].id).toBe(task.id);

      // Update
      const updateRes = await makeRequest(server.port, server.token, 'tasks/update', [
        task.id,
        { status: 'in-progress', notes: 'Working on it' },
      ]);
      expect(updateRes.body.ok).toBe(true);
      const updated = updateRes.body.data as { status: string; notes: string };
      expect(updated.status).toBe('in-progress');
      expect(updated.notes).toBe('Working on it');

      // Soft delete
      const deleteRes = await makeRequest(server.port, server.token, 'tasks/delete', [task.id]);
      expect(deleteRes.body.ok).toBe(true);

      // Verify it's gone from active list
      const afterDelete = await makeRequest(server.port, server.token, 'tasks/getActive');
      expect((afterDelete.body.data as { total: number }).total).toBe(0);

      // It should be in deleted list
      const deletedRes = await makeRequest(server.port, server.token, 'tasks/getDeleted');
      expect((deletedRes.body.data as { total: number }).total).toBe(1);

      // Restore
      const restoreRes = await makeRequest(server.port, server.token, 'tasks/restore', [task.id]);
      expect(restoreRes.body.ok).toBe(true);

      // Back in active list
      const afterRestore = await makeRequest(server.port, server.token, 'tasks/getActive');
      expect((afterRestore.body.data as { total: number }).total).toBe(1);
    });

    it('batch operations work', async () => {
      // Create 3 tasks
      const ids: string[] = [];
      for (const title of ['Task A', 'Task B', 'Task C']) {
        const res = await makeRequest(server.port, server.token, 'tasks/create', [{ title }]);
        ids.push((res.body.data as { id: string }).id);
      }

      // Batch update status
      const batchRes = await makeRequest(server.port, server.token, 'tasks/batchUpdate', [
        ids.slice(0, 2),
        { status: 'done' },
      ]);
      expect(batchRes.body.ok).toBe(true);
      expect((batchRes.body.data as { updatedCount: number }).updatedCount).toBe(2);

      // Verify done tasks
      const doneRes = await makeRequest(server.port, server.token, 'tasks/getDone');
      expect((doneRes.body.data as { total: number }).total).toBe(2);

      // Batch soft delete
      const batchDeleteRes = await makeRequest(server.port, server.token, 'tasks/batchSoftDelete', [ids]);
      expect((batchDeleteRes.body.data as { deletedCount: number }).deletedCount).toBe(3);
    });
  });

  describe('timer workflow', () => {
    it('start → status → stop → verify time entry', async () => {
      // Create a task
      const taskRes = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'Timer Test' },
      ]);
      const taskId = (taskRes.body.data as { id: string }).id;

      // Start timer
      const startRes = await makeRequest(server.port, server.token, 'timeEntries/create', [
        { taskId },
      ]);
      expect(startRes.body.ok).toBe(true);
      const entry = startRes.body.data as { id: string; taskId: string; endTime: null };
      expect(entry.taskId).toBe(taskId);
      expect(entry.endTime).toBeNull();

      // Check active
      const activeRes = await makeRequest(server.port, server.token, 'timeEntries/getActive');
      const active = activeRes.body.data as { id: string };
      expect(active.id).toBe(entry.id);

      // Stop
      const stopRes = await makeRequest(server.port, server.token, 'timeEntries/stopActive');
      expect(stopRes.body.ok).toBe(true);
      const stopped = stopRes.body.data as { durationSeconds: number; endTime: string };
      expect(stopped.endTime).not.toBeNull();
      expect(stopped.durationSeconds).toBeGreaterThanOrEqual(0);

      // No active
      const noActive = await makeRequest(server.port, server.token, 'timeEntries/getActive');
      expect(noActive.body.data).toBeNull();
    });

    it('manual time entry with duration', async () => {
      const taskRes = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'Manual Time' },
      ]);
      const taskId = (taskRes.body.data as { id: string }).id;

      const now = new Date();
      const start = new Date(now.getTime() - 5400 * 1000); // 1h30m ago

      const addRes = await makeRequest(server.port, server.token, 'timeEntries/create', [
        {
          taskId,
          startTime: start.toISOString(),
          endTime: now.toISOString(),
          note: 'Test entry',
        },
      ]);
      expect(addRes.body.ok).toBe(true);
      const entry = addRes.body.data as { durationSeconds: number; note: string };
      expect(entry.durationSeconds).toBeGreaterThan(5390);
      expect(entry.note).toBe('Test entry');
    });
  });

  describe('comment workflow', () => {
    it('creates, lists, and deletes comments', async () => {
      const taskRes = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'Comment Task' },
      ]);
      const taskId = (taskRes.body.data as { id: string }).id;

      // Add comment
      const addRes = await makeRequest(server.port, server.token, 'comments/create', [
        { taskId, body: 'Test comment', syncable: false },
      ]);
      expect(addRes.body.ok).toBe(true);
      const comment = addRes.body.data as { id: string; body: string };
      expect(comment.body).toBe('Test comment');

      // List comments
      const listRes = await makeRequest(server.port, server.token, 'comments/getByTask', [taskId]);
      expect((listRes.body.data as unknown[]).length).toBe(1);

      // Delete
      const delRes = await makeRequest(server.port, server.token, 'comments/delete', [comment.id]);
      expect(delRes.body.ok).toBe(true);

      // Verify deleted
      const afterDel = await makeRequest(server.port, server.token, 'comments/getByTask', [taskId]);
      expect((afterDel.body.data as unknown[]).length).toBe(0);
    });
  });

  describe('category workflow', () => {
    it('creates, lists, assigns, and deletes categories', async () => {
      // Create category
      const createRes = await makeRequest(server.port, server.token, 'categories/create', [
        { name: 'Work', color: '#0000ff' },
      ]);
      expect(createRes.body.ok).toBe(true);
      const cat = createRes.body.data as { id: string; name: string; color: string };
      expect(cat.name).toBe('Work');
      expect(cat.color).toBe('#0000ff');

      // List
      const listRes = await makeRequest(server.port, server.token, 'categories/getAll');
      expect((listRes.body.data as unknown[]).length).toBe(1);

      // Create task and assign category
      const taskRes = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'Categorized Task' },
      ]);
      const taskId = (taskRes.body.data as { id: string }).id;

      const assignRes = await makeRequest(server.port, server.token, 'categories/assignToTask', [
        taskId,
        [cat.id],
      ]);
      expect(assignRes.body.ok).toBe(true);

      // Verify task has category
      const taskGet = await makeRequest(server.port, server.token, 'tasks/getById', [taskId]);
      const taskData = taskGet.body.data as { categoryIds: string[] };
      expect(taskData.categoryIds).toContain(cat.id);

      // Delete category
      const delRes = await makeRequest(server.port, server.token, 'categories/delete', [cat.id]);
      expect(delRes.body.ok).toBe(true);
    });
  });

  describe('report workflow', () => {
    it('generates summary and CSV reports', async () => {
      // Create task and time entry
      const taskRes = await makeRequest(server.port, server.token, 'tasks/create', [
        { title: 'Report Task' },
      ]);
      const taskId = (taskRes.body.data as { id: string }).id;

      const now = new Date();
      const start = new Date(now.getTime() - 3600000); // 1 hour ago
      await makeRequest(server.port, server.token, 'timeEntries/create', [
        { taskId, startTime: start.toISOString(), endTime: now.toISOString() },
      ]);

      const today = now.toISOString().split('T')[0];

      // Summary report
      const summaryRes = await makeRequest(server.port, server.token, 'timeEntries/getSummaryReport', [
        `${today}T00:00:00.000Z`,
        `${today}T23:59:59.999Z`,
      ]);
      expect(summaryRes.body.ok).toBe(true);
      const summary = summaryRes.body.data as { date: string; taskTitle: string }[];
      expect(summary.length).toBeGreaterThan(0);
      expect(summary[0].taskTitle).toBe('Report Task');

      // CSV report
      const csvRes = await makeRequest(server.port, server.token, 'reports/generateCsv', [
        `${today}T00:00:00.000Z`,
        `${today}T23:59:59.999Z`,
      ]);
      expect(csvRes.body.ok).toBe(true);
      const csv = csvRes.body.data as string;
      expect(csv).toContain('Date,Task,Start,End,Duration,Note');
      expect(csv).toContain('Report Task');
    });

    it('generates today total', async () => {
      const res = await makeRequest(server.port, server.token, 'timeEntries/getTodayTotal');
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.data).toBe('number');
    });
  });

  describe('import workflow', () => {
    it('parses markdown and executes import', async () => {
      const today = new Date().toISOString().split('T')[0];
      const markdown = `# ${today}\n\n* Import Test Task: 9:00 (1h)`;

      // Preview
      const previewRes = await makeRequest(server.port, server.token, 'import/parseContent', [markdown]);
      expect(previewRes.body.ok).toBe(true);
      const parsed = previewRes.body.data as { items: { title: string; action: string }[] };
      expect(parsed.items.length).toBeGreaterThan(0);

      // Execute
      const executeRes = await makeRequest(server.port, server.token, 'import/execute', [parsed.items]);
      expect(executeRes.body.ok).toBe(true);
      const result = executeRes.body.data as { created: number; skipped: number };
      expect(result.created).toBeGreaterThan(0);

      // Verify task was created
      const tasksRes = await makeRequest(server.port, server.token, 'tasks/getActive');
      const tasks = (tasksRes.body.data as { items: { title: string }[] }).items;
      expect(tasks.some((t) => t.title.includes('Import Test Task'))).toBe(true);
    });
  });

  describe('auth enforcement', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await makeRequest(server.port, 'bad-token', 'tasks/getAll');
      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error!.code).toBe('AUTH_FAILED');
    });
  });
});
