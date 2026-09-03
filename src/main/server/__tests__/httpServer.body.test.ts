import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../../database/database';
import { startHttpServer, type HttpServerInstance } from '../httpServer';
import { createTask } from '../../ipc/taskHandlers';

/**
 * Sends a raw body without a fixed payload shape so we can test the size limit
 * and multi-byte decoding directly.
 */
function sendRaw(
  port: number,
  token: string,
  endpoint: string,
  body: string,
): Promise<{ status: number; raw: string; error?: string }> {
  return new Promise((resolve) => {
    const data = Buffer.from(body, 'utf8');
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/api/${endpoint}`,
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Authorization: `Bearer ${token}`,
          Host: `127.0.0.1:${port}`,
          Connection: 'close',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode!, raw: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', (err) => resolve({ status: 0, raw: '', error: err.message }));
    req.write(data);
    req.end();
  });
}

describe('HTTP server request body handling', () => {
  let db: Database;
  let server: HttpServerInstance;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-body-test-'));
    db = new Database(':memory:');
    server = await startHttpServer(db, tmpDir, () => null);
  });

  afterEach(async () => {
    await server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('answers an oversized body with 413 instead of resetting the socket', async () => {
    const huge = JSON.stringify({ args: [{ title: 'x'.repeat(2 * 1024 * 1024) }] });
    const res = await sendRaw(server.port, server.token, 'tasks/create', huge);

    expect(res.error).toBeUndefined();
    expect(res.status).toBe(413);
    const parsed = JSON.parse(res.raw);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('keeps serving requests after rejecting an oversized body', async () => {
    const huge = JSON.stringify({ args: [{ title: 'y'.repeat(2 * 1024 * 1024) }] });
    await sendRaw(server.port, server.token, 'tasks/create', huge);

    const ok = await sendRaw(
      server.port,
      server.token,
      'tasks/create',
      JSON.stringify({ args: [{ title: 'still alive' }] }),
    );
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.raw).ok).toBe(true);
  });

  it('round-trips multi-byte UTF-8 that straddles chunk boundaries', async () => {
    // Long enough to span several socket reads, with multi-byte characters
    // repeated throughout so at least one lands on a boundary.
    const title = '→café☕️'.repeat(20000);
    const res = await sendRaw(
      server.port,
      server.token,
      'tasks/create',
      JSON.stringify({ args: [{ title }] }),
    );

    expect(res.status).toBe(200);
    const created = JSON.parse(res.raw).data;
    expect(created.title).toBe(title);
    expect(created.title).not.toContain('�');
  });

  it('returns multi-byte content back to the client intact', async () => {
    const title = 'naïve—résumé→☕️'.repeat(15000);
    createTask(db, { title });

    const res = await sendRaw(
      server.port,
      server.token,
      'tasks/getAll',
      JSON.stringify({ args: [] }),
    );
    expect(res.status).toBe(200);
    expect(res.raw).not.toContain('�');
    const items = JSON.parse(res.raw).data;
    const found = (items.items ?? items).find((t: { title: string }) => t.title === title);
    expect(found).toBeDefined();
  });
});
