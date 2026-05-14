import * as http from 'http';
import type { Database } from '../database/database';
import type { BrowserWindow } from 'electron';
import { generateToken, writeServerFile, removeServerFile, isValidToken, isValidHost } from './auth';
import { buildRouteMap } from './apiManifest';
import { dispatchEvent } from './webhooks';

export { apiManifest, buildRouteMap } from './apiManifest';
export type { ApiRoute } from './apiManifest';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const DEFAULT_PORT = 19532;
const MAX_PORT_ATTEMPTS = 5;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export interface HttpServerInstance {
  port: number;
  token: string;
  close(): Promise<void>;
}

export async function startHttpServer(
  db: Database,
  userDataPath: string,
  getMainWindow: () => BrowserWindow | null,
): Promise<HttpServerInstance> {
  const token = generateToken();
  const routes = buildRouteMap();

  const server = http.createServer(async (req, res) => {
    // Drain request body before sending any error response to avoid ECONNRESET
    const bodyStr = await readBody(req);

    // Only accept POST to /api/*
    if (req.method !== 'POST' || !req.url?.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }

    // Host header validation (DNS rebinding protection)
    if (!isValidHost(req, actualPort)) {
      sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: 'Invalid host' } });
      return;
    }

    // Token auth
    if (!isValidToken(req, token)) {
      sendJson(res, 401, { ok: false, error: { code: 'AUTH_FAILED', message: 'Invalid or missing token' } });
      return;
    }

    // Parse route: /api/domain/operation → "domain/operation"
    const routeKey = req.url.slice(5); // Remove "/api/"
    const route = routes[routeKey];

    if (!route) {
      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `Unknown endpoint: ${routeKey}` } });
      return;
    }

    try {
      const parsed = bodyStr ? JSON.parse(bodyStr) : {};
      const args = parsed.args ?? [];
      if (!Array.isArray(args)) {
        sendJson(res, 400, {
          ok: false,
          error: { code: 'BAD_REQUEST', message: 'Request body must be { "args": [...] }' },
        });
        return;
      }

      const result = route.handler(db, ...args);

      sendJson(res, 200, { ok: true, data: result });

      // Notify renderer of data changes for mutating operations
      if (route.mutates) {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('ct:data-changed');
        }
        // Dispatch plugin webhook events (fire-and-forget; never blocks response)
        if (route.event) {
          void dispatchEvent(
            db,
            token,
            { event: route.event, route: route.route, data: result, timestamp: new Date().toISOString() },
            (msg) => process.stderr.write(`${msg}\n`),
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.includes('not found') ? 'NOT_FOUND' : 'INTERNAL';
      sendJson(res, code === 'NOT_FOUND' ? 404 : 500, {
        ok: false,
        error: { code, message },
      });
    }
  });

  let actualPort = DEFAULT_PORT;

  // Try to bind to port, incrementing on conflict
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(actualPort, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      break; // Success
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'EADDRINUSE') {
        actualPort++;
        if (attempt === MAX_PORT_ATTEMPTS - 1) {
          throw new Error(`Could not find available port (tried ${DEFAULT_PORT}-${actualPort})`);
        }
      } else {
        throw err;
      }
    }
  }

  // Write server discovery file
  writeServerFile(userDataPath, { port: actualPort, token, pid: process.pid });

  return {
    port: actualPort,
    token,
    close(): Promise<void> {
      return new Promise((resolve) => {
        removeServerFile(userDataPath);
        server.close(() => resolve());
      });
    },
  };
}
