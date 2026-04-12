import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ServerInfo {
  port: number;
  token: string;
  pid: number;
}

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function getDefaultUserDataPath(): string {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Central Tracking');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Central Tracking');
  }
  return path.join(home, '.config', 'Central Tracking');
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
  const userDataPath = getDefaultUserDataPath();
  const serverFilePath = path.join(userDataPath, 'ct-server.json');

  let content: string;
  try {
    content = fs.readFileSync(serverFilePath, 'utf-8');
  } catch {
    throw new Error('Central Tracking is not running. Start the app first.');
  }

  const info: ServerInfo = JSON.parse(content);

  if (!isProcessRunning(info.pid)) {
    throw new Error('Central Tracking is not running (stale server file). Start the app first.');
  }

  return info;
}

export function apiRequest<T = unknown>(
  server: ServerInfo,
  endpoint: string,
  args: unknown[] = [],
): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ args });
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
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        reject(new Error(`Cannot connect to Central Tracking on port ${server.port}. The app may be starting up.`));
      } else {
        reject(err);
      }
    });
    req.write(data);
    req.end();
  });
}
