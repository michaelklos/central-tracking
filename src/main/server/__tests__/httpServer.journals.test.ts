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
): Promise<{ status: number; body: Record<string, never> }> {
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

const NOTES = ['Vendor pushed the date.', '- Chase the SLA numbers'].join('\n');

describe('HTTP journal routes', () => {
  let db: Database;
  let server: HttpServerInstance;
  let tmpDir: string;

  const call = (endpoint: string, args: unknown[] = []) =>
    makeRequest(server.port, server.token, endpoint, args);

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-journal-test-'));
    db = new Database(':memory:');
    server = await startHttpServer(db, tmpDir, () => null);
  });

  afterEach(async () => {
    await server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips an entry through create, update and getAll', async () => {
    const created = await call('journals/create', [{ title: 'Vendor sync', body: NOTES }]);
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);

    const id = (created.body.data as { id: string }).id;
    const updated = await call('journals/update', [id, { title: 'Vendor sync (Q3)' }]);
    expect((updated.body.data as { title: string }).title).toBe('Vendor sync (Q3)');

    const listed = await call('journals/getAll');
    expect((listed.body.data as unknown[]).length).toBe(1);
  });

  // An omitted optional argument crosses the wire as `null`, not `undefined`
  // (JSON has no undefined), so a default parameter never fires for it.
  it('accepts an explicit null for optional arguments', async () => {
    const created = await call('journals/create', [null]);
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    expect(created.body.data as unknown as { title: string; body: string }).toMatchObject({
      title: '',
      body: '',
    });

    const listed = await call('journals/getAll', [null]);
    expect(listed.status).toBe(200);
    expect((listed.body.data as unknown[]).length).toBe(1);
  });

  it('creates a task from a selection and returns the rewritten body', async () => {
    const created = await call('journals/create', [{ body: NOTES }]);
    const id = (created.body.data as { id: string }).id;

    const res = await call('journals/createTaskFromSelection', [
      {
        journalId: id,
        selectionStart: NOTES.indexOf('Chase'),
        selectionEnd: NOTES.indexOf('Chase') + 'Chase the SLA numbers'.length,
      },
    ]);

    expect(res.status).toBe(200);
    const data = res.body.data as { journal: { body: string }; task: { id: string; title: string } };
    expect(data.task.title).toBe('Chase the SLA numbers');
    expect(data.journal.body).toContain(`[tsk:${data.task.id.slice(0, 8)}]`);

    // The task is visible on the normal task route — one transaction, both writes.
    const tasks = await call('tasks/getAll');
    expect((tasks.body.data as { id: string }[]).map((t) => t.id)).toEqual([data.task.id]);
  });

  it('returns a typed error envelope for an already-linked line', async () => {
    const created = await call('journals/create', [{ body: NOTES }]);
    const id = (created.body.data as { id: string }).id;
    const selection = {
      journalId: id,
      selectionStart: NOTES.indexOf('Chase'),
      selectionEnd: NOTES.indexOf('Chase') + 'Chase the SLA numbers'.length,
    };

    await call('journals/createTaskFromSelection', [selection]);
    const second = await call('journals/createTaskFromSelection', [selection]);

    expect(second.status).toBe(400);
    expect(second.body.ok).toBe(false);
    expect((second.body.error as { code: string }).code).toBe('ALREADY_LINKED');

    // Still exactly one task — the guard is what prevents duplicates on reread.
    const tasks = await call('tasks/getAll');
    expect((tasks.body.data as unknown[]).length).toBe(1);
  });

  it('404s for an unknown journal', async () => {
    const res = await call('journals/getById', ['no-such-journal']);
    expect(res.body.data).toBeNull();

    const action = await call('journals/createTaskFromSelection', [
      { journalId: 'no-such-journal', selectionStart: 0, selectionEnd: 1 },
    ]);
    expect(action.status).toBe(404);
    expect((action.body.error as { code: string }).code).toBe('NOT_FOUND');
  });

  it('soft-deletes and restores over HTTP', async () => {
    const created = await call('journals/create', [{ title: 'Standup', body: NOTES }]);
    const id = (created.body.data as { id: string }).id;

    await call('journals/delete', [id]);
    expect((await call('journals/getAll')).body.data).toEqual([]);

    await call('journals/restore', [id]);
    const listed = (await call('journals/getAll')).body.data as { body: string }[];
    expect(listed).toHaveLength(1);
    expect(listed[0].body).toBe(NOTES);
  });

  it('finds the journals behind a task', async () => {
    const created = await call('journals/create', [{ title: 'Vendor sync', body: NOTES }]);
    const id = (created.body.data as { id: string }).id;

    const action = await call('journals/createTaskFromSelection', [
      {
        journalId: id,
        selectionStart: NOTES.indexOf('Chase'),
        selectionEnd: NOTES.indexOf('Chase') + 'Chase the SLA numbers'.length,
      },
    ]);
    const taskId = (action.body.data as { task: { id: string } }).task.id;

    const res = await call('journals/getByTask', [taskId]);
    expect((res.body.data as { title: string }[]).map((j) => j.title)).toEqual(['Vendor sync']);
  });
});
