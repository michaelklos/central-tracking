import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface ServerInfo {
  port: number;
  token: string;
  pid: number;
}

const SERVER_FILE_NAME = 'ct-server.json';

export function getServerFilePath(userDataPath: string): string {
  return path.join(userDataPath, SERVER_FILE_NAME);
}

export function generateToken(): string {
  return uuidv4();
}

export function writeServerFile(userDataPath: string, info: ServerInfo): void {
  const filePath = getServerFilePath(userDataPath);
  fs.writeFileSync(filePath, JSON.stringify(info, null, 2), { mode: 0o600 });
  // writeFileSync's `mode` option only applies when the file is created. If
  // the file already existed (with looser perms), tighten it explicitly.
  try { fs.chmodSync(filePath, 0o600); } catch { /* ignore — best effort */ }
}

export function readServerFile(userDataPath: string): ServerInfo | null {
  const filePath = getServerFilePath(userDataPath);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as ServerInfo;
  } catch {
    return null;
  }
}

export function removeServerFile(userDataPath: string): void {
  const filePath = getServerFilePath(userDataPath);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist; that's fine
  }
}

export function isValidToken(request: { headers: Record<string, string | string[] | undefined> }, expectedToken: string): boolean {
  const authHeader = request.headers['authorization'];
  if (typeof authHeader !== 'string') return false;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;
  const providedBuf = Buffer.from(parts[1]);
  const expectedBuf = Buffer.from(expectedToken);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function isValidHost(request: { headers: Record<string, string | string[] | undefined> }, port: number): boolean {
  const host = request.headers['host'];
  if (typeof host !== 'string') return false;
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  return allowed.includes(host);
}
