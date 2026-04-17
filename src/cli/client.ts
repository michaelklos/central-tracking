import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ServerInfo {
  port: number;
  token: string;
  pid: number;
}

export interface RequestOptions {
  /** Request timeout in milliseconds. Default: 10000. */
  timeoutMs?: number;
  /** Log request/response to stderr. Default: false. */
  debug?: boolean;
  /** How many times to retry on ECONNREFUSED. Default: 1. */
  retries?: number;
  /** Base retry backoff in milliseconds. Default: 500. */
  retryDelayMs?: number;
}

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function getUserDataPaths(): string[] {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Central Tracking'),
      path.join(home, 'Library', 'Application Support', 'Electron'), // dev mode (unpackaged)
    ];
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      path.join(appData, 'Central Tracking'),
      path.join(appData, 'Electron'),
    ];
  }
  return [
    path.join(home, '.config', 'Central Tracking'),
    path.join(home, '.config', 'Electron'),
  ];
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function discoverServer(): ServerInfo {
  const paths = getUserDataPaths();

  for (const userDataPath of paths) {
    const serverFilePath = path.join(userDataPath, 'ct-server.json');

    let content: string;
    try {
      content = fs.readFileSync(serverFilePath, 'utf-8');
    } catch {
      continue; // Try next path
    }

    const info: ServerInfo = JSON.parse(content);

    if (!isProcessRunning(info.pid)) {
      continue; // Stale file, try next path
    }

    return info;
  }

  throw new Error('Central Tracking is not running. Start the app first.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendOnce<T>(
  server: ServerInfo,
  endpoint: string,
  args: unknown[],
  timeoutMs: number,
  debug: boolean,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ args });
    if (debug) {
      process.stderr.write(`[ct debug] POST /api/${endpoint} ${data}\n`);
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.port,
        path: `/api/${endpoint}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${server.token}`,
          Host: `127.0.0.1:${server.port}`,
          Connection: 'close',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => {
          if (debug) {
            process.stderr.write(`[ct debug] ${res.statusCode} ${body.slice(0, 500)}\n`);
          }
          try {
            const response: ApiResponse<T> = JSON.parse(body);
            if (response.ok) {
              resolve(response.data as T);
            } else {
              reject(new Error(response.error?.message ?? 'Unknown server error'));
            }
          } catch {
            reject(new Error(`Invalid response from server: ${body.slice(0, 200)}`));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request to /api/${endpoint} timed out after ${timeoutMs}ms`));
    });
    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

export async function apiRequest<T = unknown>(
  server: ServerInfo,
  endpoint: string,
  args: unknown[] = [],
  options: RequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const debug = options.debug ?? false;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await sendOnce<T>(server, endpoint, args, timeoutMs, debug);
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED' && attempt < retries) {
        if (debug) {
          process.stderr.write(`[ct debug] ECONNREFUSED, retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${retries})\n`);
        }
        await sleep(retryDelayMs);
        continue;
      }
      break;
    }
  }

  const code = (lastError as NodeJS.ErrnoException)?.code;
  if (code === 'ECONNREFUSED') {
    throw new Error(`Cannot connect to Central Tracking on port ${server.port}. The app may be starting up.`);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
