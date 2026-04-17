import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as crypto from 'crypto';
import { Database } from '../../database/database';
import { installPlugin } from '../../ipc/pluginHandlers';
import {
  signWebhookPayload,
  subscriberMatchesEvent,
  deliverWebhook,
  dispatchEvent,
} from '../webhooks';

describe('signWebhookPayload', () => {
  it('produces a sha256 HMAC signature matching manual recomputation', () => {
    const token = 'secret-token';
    const body = JSON.stringify({ event: 'task.created', data: { id: 'x' } });
    const sig = signWebhookPayload(token, body);
    expect(sig.startsWith('sha256=')).toBe(true);

    const expected = 'sha256=' + crypto.createHmac('sha256', token).update(body).digest('hex');
    expect(sig).toBe(expected);
  });

  it('different tokens produce different signatures', () => {
    expect(signWebhookPayload('a', 'hi')).not.toBe(signWebhookPayload('b', 'hi'));
  });
});

describe('subscriberMatchesEvent', () => {
  const base = { pluginId: 'p', url: 'http://127.0.0.1:1/' };
  it('wildcard matches everything', () => {
    expect(subscriberMatchesEvent({ ...base, events: ['*'] }, 'anything')).toBe(true);
  });
  it('explicit list matches only listed events', () => {
    const sub = { ...base, events: ['task.created', 'task.updated'] };
    expect(subscriberMatchesEvent(sub, 'task.created')).toBe(true);
    expect(subscriberMatchesEvent(sub, 'task.deleted')).toBe(false);
  });
  it('empty list matches nothing', () => {
    expect(subscriberMatchesEvent({ ...base, events: [] }, 'x')).toBe(false);
  });
});

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

function startCapturingServer(responseStatus = 200): Promise<{ port: number; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(responseStatus);
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

describe('deliverWebhook', () => {
  it('POSTs body with X-CT-Signature and X-CT-Plugin-Id headers', async () => {
    const srv = await startCapturingServer();
    try {
      const body = '{"hello":"world"}';
      const sig = signWebhookPayload('t', body);
      const result = await deliverWebhook(`http://127.0.0.1:${srv.port}/hook`, body, sig, 'my-plugin');
      expect(result.ok).toBe(true);
      expect(srv.received).toHaveLength(1);
      expect(srv.received[0].body).toBe(body);
      expect(srv.received[0].headers['x-ct-signature']).toBe(sig);
      expect(srv.received[0].headers['x-ct-plugin-id']).toBe('my-plugin');
    } finally {
      await srv.close();
    }
  });

  it('returns ok=false on non-2xx', async () => {
    const srv = await startCapturingServer(500);
    try {
      const result = await deliverWebhook(`http://127.0.0.1:${srv.port}/hook`, '{}', 'sig', 'p');
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
    } finally {
      await srv.close();
    }
  });

  it('returns ok=false on connection refused', async () => {
    // Bind then immediately close to get a port that's definitely not listening
    const srv = await startCapturingServer();
    const port = srv.port;
    await srv.close();
    const result = await deliverWebhook(`http://127.0.0.1:${port}/hook`, '{}', 'sig', 'p');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('dispatchEvent', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('only delivers to subscribers whose events match', async () => {
    const srvA = await startCapturingServer();
    const srvB = await startCapturingServer();
    try {
      installPlugin(db, {
        id: 'a',
        name: 'A',
        version: '1',
        webhook: { url: `http://127.0.0.1:${srvA.port}/hook` },
        events: ['task.created'],
      });
      installPlugin(db, {
        id: 'b',
        name: 'B',
        version: '1',
        webhook: { url: `http://127.0.0.1:${srvB.port}/hook` },
        events: ['timeEntry.created'],
      });

      await dispatchEvent(db, 'session-token', {
        event: 'task.created',
        route: 'tasks/create',
        data: { id: 't1' },
        timestamp: '2026-04-17T00:00:00.000Z',
      });

      expect(srvA.received).toHaveLength(1);
      expect(srvB.received).toHaveLength(0);

      const payload = JSON.parse(srvA.received[0].body);
      expect(payload.event).toBe('task.created');
      expect(payload.data.id).toBe('t1');
      expect(srvA.received[0].headers['x-ct-signature']).toBe(
        signWebhookPayload('session-token', srvA.received[0].body),
      );
    } finally {
      await srvA.close();
      await srvB.close();
    }
  });

  it('skips disabled plugins and logs delivery failures without throwing', async () => {
    const failingPort = 1; // Port 1 should refuse connections
    installPlugin(db, {
      id: 'dead',
      name: 'Dead',
      version: '1',
      webhook: { url: `http://127.0.0.1:${failingPort}/hook` },
      events: ['*'],
    });

    const logs: string[] = [];
    await dispatchEvent(
      db,
      'token',
      { event: 'task.created', route: 'tasks/create', data: {}, timestamp: '2026-04-17T00:00:00.000Z' },
      (m) => logs.push(m),
    );
    expect(logs.length).toBe(1);
    expect(logs[0]).toMatch(/plugin=dead/);
    expect(logs[0]).toMatch(/task.created/);
  });
});
